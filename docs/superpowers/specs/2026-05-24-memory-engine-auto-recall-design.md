# Memory Engine Auto Recall Design

## Goal
Add an explicit opt-in autoRecall feature to memory-engine. When enabled, the plugin runs before_prompt_build before each model call, performs the existing hybrid memory search, and injects the top relevant memories into the turn context.

## Scope
The feature is disabled by default through config. It does not depend on active-memory. It uses memory-engine own hybrid search results and keeps the memory_engine search tool behavior aligned with autoRecall.

## Behavior
The hook skips slash commands, greetings, simple acknowledgements, and very short prompts unless a memory trigger phrase is present. Memory trigger phrases such as remember, recall, memory, 记得, 记忆, 之前, 上次, 我说过, 回忆, 偏好, and 习惯 force recall except for slash commands.

## Injection
The hook returns prependContext with up to autoRecall.topK results, default 3. The injected context tells the model to use entries only when relevant and to cite relied-on memory ids through memory_engine action=cite.

## Error Handling
Hook failures are non-fatal. The plugin logs a warning and continues without injected memory.
