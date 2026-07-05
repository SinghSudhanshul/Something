import {
  TextractClient,
  AnalyzeDocumentCommand,
  Block,
} from '@aws-sdk/client-textract';
import { config as env } from '../../config.js';
import { logger } from '../../index.js';

const textractClient = new TextractClient({ region: env.AWS_REGION });

export interface ExtractedIDData {
  student_id: string | null;
  full_name: string | null;
  department: string | null;
  institution: string | null;
  confidence: number;
}

export async function analyzeStudentID(s3Key: string): Promise<ExtractedIDData> {
  if (env.NODE_ENV !== 'production') {
    logger.debug(`[DEV Textract] Mocking analysis for ${s3Key}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      student_id: 'RA2211003010123',
      full_name: 'Rahul Kumar',
      department: 'Computer Science Engineering',
      institution: 'SRM Institute of Science and Technology',
      confidence: 97.5,
    };
  }

  try {
    const command = new AnalyzeDocumentCommand({
      Document: {
        S3Object: {
          Bucket: env.AWS_S3_DOCUMENTS_BUCKET,
          Name: s3Key,
        },
      },
      FeatureTypes: ['FORMS'],
    });

    const response = await textractClient.send(command);

    if (!response.Blocks) {
      return {
        student_id: null,
        full_name: null,
        department: null,
        institution: null,
        confidence: 0,
      };
    }

    const keyMap: Record<string, Block> = {};
    const valueMap: Record<string, Block> = {};
    const blockMap: Record<string, Block> = {};

    response.Blocks.forEach((block) => {
      if (block.Id) {blockMap[block.Id] = block;}
      if (block.BlockType === 'KEY_VALUE_SET') {
        if (block.EntityTypes?.includes('KEY')) {
          if (block.Id) {keyMap[block.Id] = block;}
        } else {
          if (block.Id) {valueMap[block.Id] = block;}
        }
      }
    });

    const findValueAndConfidence = (keyBlock: Block) => {
      let value = '';
      let confidence = 0;
      let count = 0;

      const valueRelation = keyBlock.Relationships?.find((r) => r.Type === 'VALUE');
      if (valueRelation) {
        valueRelation.Ids?.forEach((valId) => {
          const valBlock = valueMap[valId];
          if (valBlock && valBlock.Relationships) {
            valBlock.Relationships.forEach((wordRel) => {
              if (wordRel.Type === 'CHILD') {
                wordRel.Ids?.forEach((wordId) => {
                  const wordBlock = blockMap[wordId];
                  if (wordBlock && wordBlock.Text) {
                    value += wordBlock.Text + ' ';
                    confidence += wordBlock.Confidence || 0;
                    count++;
                  }
                });
              }
            });
          }
        });
      }
      return {
        value: value.trim(),
        confidence: count > 0 ? confidence / count : 0,
      };
    };

    const extracted: ExtractedIDData = {
      student_id: null,
      full_name: null,
      department: null,
      institution: null,
      confidence: 0,
    };

    let totalConfidence = 0;
    let fieldsFound = 0;

    for (const keyId in keyMap) {
      const keyBlock = keyMap[keyId];
      if (!keyBlock) {continue;}
      let keyText = '';
      keyBlock.Relationships?.forEach((r) => {
        if (r.Type === 'CHILD') {
          r.Ids?.forEach((wordId) => {
            if (blockMap[wordId] && blockMap[wordId].Text) {
              keyText += blockMap[wordId].Text + ' ';
            }
          });
        }
      });
      keyText = keyText.trim().toLowerCase();

      const { value, confidence } = findValueAndConfidence(keyBlock);

      if (value) {
        if (keyText.includes('name')) {
          extracted.full_name = value;
          totalConfidence += confidence;
          fieldsFound++;
        } else if (keyText.includes('register') || keyText.includes('reg') || keyText.includes('student')) {
          extracted.student_id = value;
          totalConfidence += confidence;
          fieldsFound++;
        } else if (keyText.includes('department') || keyText.includes('dept') || keyText.includes('course')) {
          extracted.department = value;
          totalConfidence += confidence;
          fieldsFound++;
        } else if (keyText.includes('institute') || keyText.includes('university') || keyText.includes('srm')) {
          extracted.institution = value;
          totalConfidence += confidence;
          fieldsFound++;
        }
      }
    }

    extracted.confidence = fieldsFound > 0 ? totalConfidence / fieldsFound : 0;
    return extracted;
  } catch (error: any) {
    logger.error({ err: error, s3Key }, 'Textract analysis failed');
    throw error;
  }
}
