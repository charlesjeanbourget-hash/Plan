import * as React from 'react';

export function Toaster(props: {
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  richColors?: boolean;
  expand?: boolean;
  closeButton?: boolean;
  theme?: 'light' | 'dark' | 'system';
  className?: string;
}): React.JSX.Element;
