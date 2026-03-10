import { useMemo } from 'react';
import { createAssistantClient } from '../lib/assistantClient';

export function useAssistantChat() {
  return useMemo(() => createAssistantClient(), []);
}
