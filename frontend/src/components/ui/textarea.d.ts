import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Textarea: React.ForwardRefExoticComponent<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & DataAttrs & React.RefAttributes<HTMLTextAreaElement>
>;
