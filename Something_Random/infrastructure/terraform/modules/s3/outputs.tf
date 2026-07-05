output "media_bucket_name" {
  value = aws_s3_bucket.media.id
}

output "media_bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "documents_bucket_name" {
  value = aws_s3_bucket.documents.id
}

output "documents_bucket_arn" {
  value = aws_s3_bucket.documents.arn
}

output "logs_bucket_name" {
  value = aws_s3_bucket.logs.id
}

output "backups_bucket_name" {
  value = aws_s3_bucket.backups.id
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.media.id
}
