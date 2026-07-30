import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Switch: React.ForwardRefExoticComponent<
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
    checked?: boolean;
    defaultChecked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;
