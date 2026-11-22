import { msg } from "@lingui/core/macro";

// Descriptions from speech/catalog.rs, where the English text is the message id.
// Nothing imports this: it exists so lingui extract writes them into messages.po.
export const MODEL_DESCRIPTION_STRINGS = [
  msg({
    id: "Multilingual Parakeet TDT V3 on CPU or GPU, with optional Neural Engine acceleration on Apple Silicon.",
  }),
  msg({
    id: "Multilingual (25 languages) fine-tune of Parakeet TDT V3 by Moondream. More accurate than V3 at the same speed and size.",
  }),
  msg({ id: "Built into this Mac. Nothing to download." }),
  msg({
    id: "Great quality local Whisper model with multilingual support and dictionary support.",
  }),
  msg({
    id: "Multilingual Qwen3-ASR with optional Neural Engine acceleration on Apple Silicon.",
  }),
  msg({ id: "Fast multilingual transcription with streaming support." }),
  msg({ id: "Fast English local transcription with streaming support." }),
  msg({
    id: "Multilingual streaming transcription with punctuation and capitalization.",
  }),
  msg({ id: "Real-time streaming transcription. Text appears as you speak." }),
  msg({ id: "Small & fast with dictionary support." }),
  msg({
    id: "Fast English-only Distil-Whisper Q8 model. Dictionary support is limited.",
  }),
  msg({
    id: "Local Whisper model with multilingual support and dictionary support.",
  }),
];
