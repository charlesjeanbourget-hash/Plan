import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Checkbox: React.ForwardRefExoticComponent<
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
    checked?: boolean | 'indeterminate';
    defaultChecked?: boolean;
    onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  } & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;
