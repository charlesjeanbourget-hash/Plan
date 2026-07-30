import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Input: React.ForwardRefExoticComponent<
  React.InputHTMLAttributes<HTMLInputElement> & DataAttrs & React.RefAttributes<HTMLInputElement>
>;
