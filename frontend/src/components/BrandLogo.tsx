import logo from '@/assets/logo-arriere-plan.png';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  withText?: boolean;
  hideTextOnSmall?: boolean;
}

const HEIGHTS: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-9 sm:h-10',
  md: 'h-10 sm:h-12',
  lg: 'h-16 sm:h-20',
};

export const BrandLogo = ({ size = 'md', withText = true, hideTextOnSmall = false }: Props): JSX.Element => (
  <div className="flex items-center gap-2 sm:gap-2.5 shrink-0" data-testid="brand-logo">
    <img src={logo} alt="Arrière Plan" className={`${HEIGHTS[size]} w-auto object-contain`} />
    {withText && (
      <span className={`font-heading font-bold text-slate-900 leading-tight whitespace-nowrap ${size === 'lg' ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'} ${hideTextOnSmall ? 'hidden min-[480px]:inline' : ''}`}>
        Arrière <span className="text-bronze-600">Plan</span>
      </span>
    )}
  </div>
);
