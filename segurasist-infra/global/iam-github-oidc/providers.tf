terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Uses 4 provider aliases (one per workload account + bootstrap-from-mgmt for assume).
# Each runs against the named account; CI/CD assumes the OrganizationAccountAccessRole.

provider "aws" {
  alias  = "dev"
  region = "mx-central-1"
  assume_role {
    role_arn     = "arn:aws:iam::${var.account_ids.dev}:role/OrganizationAccountAccessRole"
    session_name = "tf-github-oidc-dev"
  }
  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "dev"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
    }
  }
}

provider "aws" {
  alias  = "staging"
  region = "mx-central-1"
  assume_role {
    role_arn     = "arn:aws:iam::${var.account_ids.staging}:role/OrganizationAccountAccessRole"
    session_name = "tf-github-oidc-staging"
  }
  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "staging"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
    }
  }
}

provider "aws" {
  alias  = "prod"
  region = "mx-central-1"
  assume_role {
    role_arn     = "arn:aws:iam::${var.account_ids.prod}:role/OrganizationAccountAccessRole"
    session_name = "tf-github-oidc-prod"
  }
  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "prod"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
    }
  }
}
