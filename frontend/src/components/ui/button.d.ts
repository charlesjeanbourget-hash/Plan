import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

export const Button: React.ForwardRefExoticComponent<
  ButtonProps & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;
