data "aws_region" "current" {}

############################################
# Identity + DKIM
############################################

resource "aws_sesv2_email_identity" "this" {
  email_identity = var.domain

  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = merge(var.tags, { Name = var.domain })
}

resource "aws_sesv2_email_identity_mail_from_attributes" "this" {
  email_identity         = aws_sesv2_email_identity.this.email_identity
  mail_from_domain       = "${var.mail_from_subdomain}.${var.domain}"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}

############################################
# Route53 records: DKIM, MAIL FROM (MX + SPF), domain SPF + DMARC
############################################

resource "aws_route53_record" "dkim" {
  for_each = toset(aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens)

  zone_id = var.route53_zone_id
  name    = "${each.value}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${each.value}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.route53_zone_id
  name    = aws_sesv2_email_identity_mail_from_attributes.this.mail_from_domain
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${data.aws_region.current.name}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.route53_zone_id
  name    = aws_sesv2_email_identity_mail_from_attributes.this.mail_from_domain
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com -all"]
}

resource "aws_route53_record" "domain_spf" {
  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com -all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = [
    var.dmarc_rua == null
    ? "v=DMARC1; p=${var.dmarc_policy}; sp=${var.dmarc_policy}; adkim=s; aspf=s; fo=1"
    : "v=DMARC1; p=${var.dmarc_policy}; sp=${var.dmarc_policy}; adkim=s; aspf=s; fo=1; rua=mailto:${var.dmarc_rua}; ruf=mailto:${var.dmarc_rua}"
  ]
}

############################################
# Configuration set + SNS event destination
############################################

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = var.configuration_set_name

  delivery_options {
    tls_policy = var.tls_policy
  }

  reputation_options {
    reputation_metrics_enabled = var.reputation_metrics_enabled
  }

  sending_options {
    sending_enabled = true
  }

  tags = var.tags
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "${var.configuration_set_name}-sns"

  event_destination {
    enabled              = true
    matching_event_types = [for t in var.event_types : upper(t)]

    sns_destination {
      topic_arn = var.sns_topic_arn
    }
  }
}
