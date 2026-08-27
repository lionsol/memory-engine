import { createHash } from "node:crypto";

import { normalizeFtsQuery } from "../../query-utils.js";
import {
  LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  runLongMemEvalSemanticRetrievalCase,
  runLongMemEvalSemanticRetrievalDataset,
} from "./longmemeval-semantic-retrieval-runner-v1.js";

export const LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE =
  "production_hybrid_semantic_query_instruction_session_v1";
export const SEMANTIC_QUERY_INSTRUCTION_VERSION = "query_embedding_instruction_v1";
export const SEMANTIC_QUERY_INSTRUCTION_TEXT =
  "Instruct: Given a memory retrieval query, retrieve relevant past conversation passages that provide the context needed to answer the query";
export const SEMANTIC_QUERY_INSTRUCTION_SHA256 = createHash("sha256")
  .update(SEMANTIC_QUERY_INSTRUCTION_TEXT)
  .digest("hex");
export const SEMANTIC_QUERY_FORMATTING_CONTRACT =
  "query_embedding_input = query_instruction_text + LF + \"Query:\" + normalizeFtsQuery(query); no trailing LF";
export const SEMANTIC_DOCUMENT_INSTRUCTION = "none";

const RH1_PROFILE_PROVENANCE = Object.freeze({
  query_instruction_version: SEMANTIC_QUERY_INSTRUCTION_VERSION,
  query_instruction_text: SEMANTIC_QUERY_INSTRUCTION_TEXT,
  query_instruction_sha256: SEMANTIC_QUERY_INSTRUCTION_SHA256,
  query_formatting_contract: SEMANTIC_QUERY_FORMATTING_CONTRACT,
  document_instruction: SEMANTIC_DOCUMENT_INSTRUCTION,
});

export function formatSemanticQueryInstructionEmbeddingInput(query) {
  const normalizedQuery = normalizeFtsQuery(query);
  return `${SEMANTIC_QUERY_INSTRUCTION_TEXT}\nQuery:${normalizedQuery}`;
}

function rh1Options(options = {}) {
  return {
    ...options,
    profile: LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE,
    queryEmbeddingInputTransform: formatSemanticQueryInstructionEmbeddingInput,
    profileProvenance: RH1_PROFILE_PROVENANCE,
  };
}

export async function runLongMemEvalSemanticQueryInstructionRetrievalCase(record, options = {}) {
  const result = await runLongMemEvalSemanticRetrievalCase(record, rh1Options(options));
  if (result?.schema !== LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA ||
      result.profile !== LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE) {
    throw new Error("semantic_query_instruction_profile_contract_mismatch");
  }
  return result;
}

export async function runLongMemEvalSemanticQueryInstructionRetrievalDataset(records, options = {}) {
  const output = await runLongMemEvalSemanticRetrievalDataset(records, rh1Options(options));
  if (output?.schema !== LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA ||
      output.profile !== LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE ||
      output.summary?.profile !== LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE) {
    throw new Error("semantic_query_instruction_profile_contract_mismatch");
  }
  return output;
}
