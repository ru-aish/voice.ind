function accumulateToolCallDelta(accumulatedToolCalls, toolCallDelta) {
  const index = toolCallDelta.index;
  let accumulated = accumulatedToolCalls.get(index);

  if (!accumulated) {
    accumulated = {
      id: toolCallDelta.id || '',
      type: toolCallDelta.type || 'function',
      function: {
        name: toolCallDelta.function?.name || '',
        arguments: '',
      },
    };
    accumulatedToolCalls.set(index, accumulated);
  }

  if (toolCallDelta.id) {
    accumulated.id = toolCallDelta.id;
  }
  if (toolCallDelta.function?.name) {
    accumulated.function.name = toolCallDelta.function.name;
  }
  if (toolCallDelta.function?.arguments) {
    accumulated.function.arguments += toolCallDelta.function.arguments;
  }
}

async function flushAccumulatedToolCalls(accumulatedToolCalls, metrics, onToolCall) {
  if (accumulatedToolCalls.size === 0) {
    return;
  }

  const sortedIndices = [...accumulatedToolCalls.keys()].sort((a, b) => a - b);
  for (const index of sortedIndices) {
    const toolCall = accumulatedToolCalls.get(index);
    metrics.toolCalls.push(toolCall);
    if (onToolCall) {
      await onToolCall(toolCall);
    }
  }
}

module.exports = {
  accumulateToolCallDelta,
  flushAccumulatedToolCalls,
};
