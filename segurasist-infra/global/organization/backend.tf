terraform {
  required_version = ">= 1.7.0, < 2.0.0"

  backend "s3" {
    bucket         = "segurasist-tfstate-root"
    key            = "global/organization/main.tfstate"
    region         = "mx-central-1"
    dynamodb_table = "terraform-lock-root"
    encrypt        = true
    kms_key_id     = "alias/segurasist-tfstate"
  }
}
