############################################
# WAFv2 Web ACL — S3-10
#
# AWS Managed Rules (CommonRuleSet, KnownBadInputs, SQLi, AmazonIpReputation,
# AnonymousIpList) + rate-based per-IP + logging redactado.
#
# Decisiones de diseño:
#
# - default_action = allow: WAF es deny-by-rule, no allowlist. Las managed
#   rules de AWS deciden qué bloquear; lo que no matchea pasa.
#
# - AnonymousIpList en COUNT por default (ver var.anonymous_ip_action). Audit
#   Sprint 1 detectó que hospitales usan VPN corporativa que cae en ese rule
#   group; bloquear sin un baseline de tráfico romperia operativa legítima.
#   Con CISO se prevé re-evaluar a BLOCK tras 30 días en COUNT.
#
# - Rate-based statement: agregate_key_type = IP (no FORWARDED_IP) — mx-central-1
#   App Runner termina TLS y reescribe X-Forwarded-For, así que el IP cliente
#   ya viene resuelto al WAF. CLOUDFRONT-scope tampoco necesita FORWARDED_IP
#   porque CloudFront populate `X-Forwarded-For` antes de pasar a WAF.
#   La ventana es FIJA de 5min (mínimo de WAFv2) — para ventanas más cortas
#   usar el Throttler aplicación-level (que sí soporta 1min).
#
# - Logging: el destination_arn debe ser un Firehose con name `aws-waf-logs-*`
#   (constraint AWS) o un CW Log Group también con ese prefijo. El módulo
#   espera que el caller cree y administre el destino — eso permite reusar
#   un Log Group/Firehose entre múltiples Web ACLs y mantener el TTL/KMS
#   bajo control del env.
#
# - redacted_fields: authorization + cookie por default. SIN esta redacción
#   los logs llevarían el JWT del usuario (= takeover trivial si los logs
#   leakean). El operador puede agregar headers extra vía
#   var.redacted_header_names.
############################################

locals {
  # Indexamos las rule groups para asignar prioridades estables (1..N).
  # El orden importa porque WAFv2 evalúa rules de menor a mayor priority
  # y short-circuita en la primera ALLOW/BLOCK final. Las managed rule
  # groups con override 'none' no short-circuitan; el rate-based sí.
  managed_rules_indexed = { for idx, name in var.managed_rule_groups : name => idx + 1 }

  # Conversión opcional: si var.rate_limit_per_ip != null, lo tomamos como
  # "req/min" y multiplicamos por 5 para obtener el threshold en la ventana
  # nativa de WAFv2 (5min). Default 100 req/min = 500 / 5min.
  effective_rate_limit = var.rate_limit_per_ip != null ? var.rate_limit_per_ip * 5 : var.rate_limit_per_5min

  # AnonymousIpList recibe override `count` o `block` en runtime.
  anonymous_ip_rule_group = "AWSManagedRulesAnonymousIpList"
}

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = var.scope

  default_action {
    allow {}
  }

  ##############################################
  # Managed rule groups (1..N por var.managed_rule_groups)
  ##############################################
  dynamic "rule" {
    for_each = local.managed_rules_indexed
    content {
      name     = rule.key
      priority = rule.value

      # AnonymousIpList: COUNT por default (ver locals + var). El resto:
      # `none {}` = respeta las acciones del managed rule group (typically
      # BLOCK para findings críticos, COUNT para el resto).
      override_action {
        dynamic "count" {
          for_each = (rule.key == local.anonymous_ip_rule_group && var.anonymous_ip_action == "count") ? [1] : []
          content {}
        }
        dynamic "none" {
          for_each = !(rule.key == local.anonymous_ip_rule_group && var.anonymous_ip_action == "count") ? [1] : []
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
        }
      }

      visibility_config {
        sampled_requests_enabled   = true
        cloudwatch_metrics_enabled = true
        # Sanitizamos a alfanumérico — WAFv2 rechaza nombres con guiones medios
        # en metric_name aunque el resource accepta el id con guiones.
        metric_name = replace(rule.key, "/[^A-Za-z0-9]/", "")
      }
    }
  }

  ##############################################
  # Rate-based: bloqueo por IP cuando excede umbral en ventana 5min.
  # Priority = (managed_rules.length + 10) para dejar holgura entre
  # managed groups y custom rules futuras (Sprint 5: per-tenant labels).
  ##############################################
  rule {
    name     = "rate-limit-per-ip"
    priority = length(var.managed_rule_groups) + 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = local.effective_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitPerIP"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = replace(var.name, "-", "")
  }

  tags = merge(var.tags, { Name = var.name, ManagedRulesCount = tostring(length(var.managed_rule_groups)) })
}

############################################
# Logging configuration
#
# El destino (Firehose 'aws-waf-logs-*' o CW Log Group 'aws-waf-logs-*') lo
# crea y administra el caller — esto permite:
#   - Reusar un único Firehose para múltiples Web ACLs (REGIONAL + CLOUDFRONT).
#   - Mantener KMS, TTL y retención bajo control del env (no del módulo).
#   - Cambiar de CW → Firehose (volumetrías altas) sin re-deploy del módulo.
############################################

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count = var.log_destination_arn == null ? 0 : 1

  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [var.log_destination_arn]

  # Redactamos headers sensibles ANTES de que salgan del WAF. El forensics
  # downstream pierde algo de visibilidad, pero un dump de logs no expone
  # JWTs ni cookies de sesión. authorization + cookie por default; agregá
  # x-api-key u otros vía var.redacted_header_names si hay clientes M2M.
  dynamic "redacted_fields" {
    for_each = toset(var.redacted_header_names)
    content {
      single_header {
        name = redacted_fields.value
      }
    }
  }
}
