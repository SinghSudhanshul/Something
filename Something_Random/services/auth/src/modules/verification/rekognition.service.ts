import {
  RekognitionClient,
  CompareFacesCommand,
} from '@aws-sdk/client-rekognition';
import { config as env } from '../../config.js';
import { logger } from '../../index.js';

const rekognitionClient = new RekognitionClient({ region: env.AWS_REGION });

export async function compareFaces(sourceS3Key: string, targetS3Key: string): Promise<number> {
  if (env.NODE_ENV !== 'production') {
    logger.debug(`[DEV Rekognition] Mocking face match for ${sourceS3Key} and ${targetS3Key}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return 94.5;
  }

  try {
    const command = new CompareFacesCommand({
      SourceImage: {
        S3Object: {
          Bucket: env.AWS_S3_DOCUMENTS_BUCKET,
          Name: sourceS3Key,
        },
      },
      TargetImage: {
        S3Object: {
          Bucket: env.AWS_S3_DOCUMENTS_BUCKET,
          Name: targetS3Key,
        },
      },
      SimilarityThreshold: 0, // Get the similarity score even if low
    });

    const response = await rekognitionClient.send(command);

    if (response.FaceMatches && response.FaceMatches.length > 0) {
      return response.FaceMatches?.[0]?.Similarity || 0;
    }

    return 0;
  } catch (error: any) {
    logger.error({ err: error, sourceS3Key, targetS3Key }, 'Rekognition compareFaces failed');
    throw error;
  }
}
