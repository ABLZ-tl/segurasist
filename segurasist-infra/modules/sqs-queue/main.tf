locals {
  base_name = var.name
  fifo_sfx  = var.fifo_queue ? ".fifo" : ""
}

resource "aws_sqs_queue" "dlq" {
  name                              = "${local.base_name}-dlq${local.fifo_sfx}"
  fifo_queue                        = var.fifo_queue
  message_retention_seconds         = var.dlq_message_retention_seconds
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300

  tags = merge(var.tags, { Name = "${local.base_name}-dlq", Role = "dlq" })
}

resource "aws_sqs_queue" "this" {
  name                              = "${local.base_name}${local.fifo_sfx}"
  fifo_queue                        = var.fifo_queue
  visibility_timeout_seconds        = var.visibility_timeout_seconds
  message_retention_seconds         = var.message_retention_seconds
  max_message_size                  = var.max_message_size
  delay_seconds                     = var.delay_seconds
  receive_wait_time_seconds         = var.receive_wait_time_seconds
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = merge(var.tags, { Name = local.base_name })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.url

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}
