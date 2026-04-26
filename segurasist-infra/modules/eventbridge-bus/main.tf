resource "aws_cloudwatch_event_bus" "this" {
  name              = var.name
  kms_key_identifier = var.kms_key_arn

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_cloudwatch_event_archive" "this" {
  count = var.archive_enabled ? 1 : 0

  name             = "${var.name}-archive"
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  description      = "Archive for ${var.name} (replay support)"
  retention_days   = var.archive_retention_days
  event_pattern    = var.archive_event_pattern
}
