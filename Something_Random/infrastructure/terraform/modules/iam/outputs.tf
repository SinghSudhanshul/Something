output "ecs_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "auth_task_role_arn" {
  value = aws_iam_role.auth_task.arn
}

output "bazaar_task_role_arn" {
  value = aws_iam_role.bazaar_task.arn
}

output "wallet_task_role_arn" {
  value = aws_iam_role.wallet_task.arn
}

output "notifications_task_role_arn" {
  value = aws_iam_role.notifications_task.arn
}

output "generic_task_role_arn" {
  value = aws_iam_role.generic_task.arn
}
