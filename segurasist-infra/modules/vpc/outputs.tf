output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "VPC CIDR block"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Map of AZ -> public subnet ID"
  value       = { for az, s in aws_subnet.public : az => s.id }
}

output "private_app_subnet_ids" {
  description = "Map of AZ -> private-app subnet ID"
  value       = { for az, s in aws_subnet.private_app : az => s.id }
}

output "private_data_subnet_ids" {
  description = "Map of AZ -> private-data subnet ID"
  value       = { for az, s in aws_subnet.private_data : az => s.id }
}

output "public_subnet_id_list" {
  description = "List of public subnet IDs"
  value       = [for s in aws_subnet.public : s.id]
}

output "private_app_subnet_id_list" {
  description = "List of private-app subnet IDs"
  value       = [for s in aws_subnet.private_app : s.id]
}

output "private_data_subnet_id_list" {
  description = "List of private-data subnet IDs"
  value       = [for s in aws_subnet.private_data : s.id]
}

output "sg_alb_id" {
  description = "Security group ID for ALB"
  value       = aws_security_group.alb.id
}

output "sg_apprunner_id" {
  description = "Security group ID for App Runner connector"
  value       = aws_security_group.apprunner.id
}

output "sg_lambda_vpc_id" {
  description = "Security group ID for VPC Lambdas"
  value       = aws_security_group.lambda_vpc.id
}

output "sg_rds_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}

output "sg_redis_id" {
  description = "Security group ID for Redis"
  value       = aws_security_group.redis.id
}

output "sg_bastion_id" {
  description = "Security group ID for bastion"
  value       = aws_security_group.bastion.id
}

output "sg_vpce_id" {
  description = "Security group ID for VPC interface endpoints"
  value       = aws_security_group.vpce.id
}

output "nat_gateway_ids" {
  description = "Map AZ -> NAT Gateway ID"
  value       = { for az, n in aws_nat_gateway.this : az => n.id }
}
