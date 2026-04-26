terraform {
  required_version = ">= 1.7.0, < 2.0.0"

  backend "s3" {
    bucket         = "segurasist-tfstate-prod"
    key            = "global/route53/main.tfstate"
    region         = "mx-central-1"
    dynamodb_table = "terraform-lock-prod"
    encrypt        = true
    kms_key_id     = "alias/segurasist-tfstate"
  }
}
