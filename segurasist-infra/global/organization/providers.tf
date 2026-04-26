terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Runs in the management (root) account.
provider "aws" {
  region = "mx-central-1"

  default_tags {
    tags = {
      Project   = "SegurAsist"
      Env       = "global"
      Owner     = "platform"
      ManagedBy = "Terraform"
      CostCtr   = "MAC-MVP"
    }
  }
}
