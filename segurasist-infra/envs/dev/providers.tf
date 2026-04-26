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
