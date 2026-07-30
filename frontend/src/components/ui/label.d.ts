import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Label: React.ForwardRefExoticComponent<
  React.LabelHTMLAttributes<HTMLLabelElement> & DataAttrs & React.RefAttributes<HTMLLabelElement>
>;
