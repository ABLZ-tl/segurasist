terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.40"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# Runs in prod account (where the public zone lives).
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

# CloudFront / Amplify Hosting require ACM certificates in us-east-1
# regardless of the workload region. This alias is passed in by the caller.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

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
