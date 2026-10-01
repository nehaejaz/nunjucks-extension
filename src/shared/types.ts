export interface TemplateUpdatedMessage {
  type: 'template-updated'
  source: 'content' | 'sidepanel'
  value: string
}

export interface FieldUnavailableMessage {
  type: 'field-unavailable'
}

export interface RequestCurrentValueMessage {
  type: 'request-current-value'
}

export type ExtensionMessage =
  | TemplateUpdatedMessage
  | FieldUnavailableMessage
  | RequestCurrentValueMessage
