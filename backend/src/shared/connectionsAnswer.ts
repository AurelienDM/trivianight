/** Parse / serialize connections team answers. */

export interface ConnectionsAnswerPayload {
  idents: string[];
  connection: string;
}

export function parseConnectionsAnswer(raw: string): ConnectionsAnswerPayload {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { idents: [], connection: '' };
  try {
    const parsed = JSON.parse(trimmed) as Partial<ConnectionsAnswerPayload>;
    if (parsed && typeof parsed === 'object' && ('connection' in parsed || 'idents' in parsed)) {
      return {
        idents: Array.isArray(parsed.idents) ? parsed.idents.map((s) => String(s ?? '')) : [],
        connection: String(parsed.connection ?? '').trim(),
      };
    }
  } catch {
    /* plain string = connection only (legacy) */
  }
  return { idents: [], connection: trimmed };
}

export function serializeConnectionsAnswer(payload: ConnectionsAnswerPayload): string {
  return JSON.stringify({
    idents: payload.idents.map((s) => String(s ?? '')),
    connection: String(payload.connection ?? '').trim(),
  });
}

/** Value graded against acceptedAnswers — connection field only. */
export function connectionsGradeInput(raw: string): string {
  return parseConnectionsAnswer(raw).connection;
}
