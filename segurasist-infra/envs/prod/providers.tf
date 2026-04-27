terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = var.environment
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
    }
  }
}

provider "aws" {
  alias  = "dr"
  region = var.aws_dr_region

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = var.environment
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
      Region    = "DR"
    }
  }
}

# us-east-1 alias DEDICADO para recursos CLOUDFRONT-scoped (WAF para
# Amplify Hosting; ACM cert para CloudFront). CloudFront es global pero
# los recursos asociados (WAF CLOUDFRONT, ACM) deben vivir en us-east-1.
# Este alias coincide con `dr` en región pero los mantenemos separados
# para que el blast radius / lifecycle de "DR" (RDS replica, KMS DR) sea
# distinto del lifecycle de "edge" (WAF CF, ACM CF).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = var.environment
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
      Scope     = "edge"
    }
  }
}
