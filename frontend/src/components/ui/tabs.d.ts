import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Tabs: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
  } & React.RefAttributes<HTMLDivElement>
>;

export const TabsList: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;

export const TabsTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string } & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;

export const TabsContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { value: string } & React.RefAttributes<HTMLDivElement>
>;
