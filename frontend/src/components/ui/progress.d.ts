import * as React from 'react';

export const Progress: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { value?: number; max?: number } & React.RefAttributes<HTMLDivElement>
>;
