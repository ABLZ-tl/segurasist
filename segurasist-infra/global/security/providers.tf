terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Runs against the security account (GuardDuty / SH / Config delegated administrator).
provider "aws" {
  region = "mx-central-1"

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "global"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
      Account   = "security"
    }
  }
}

# log-archive account (cross-account assume role).
provider "aws" {
  alias  = "log_archive"
  region = "mx-central-1"

  assume_role {
    role_arn     = "arn:aws:iam::${var.log_archive_account_id}:role/OrganizationAccountAccessRole"
    session_name = "tf-security-log-archive"
  }

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "global"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
      Account   = "log-archive"
    }
  }
}
