import logo from '@/assets/logo-arriere-plan.png';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  withText?: boolean;
}

const HEIGHTS: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-10',
  md: 'h-12',
  lg: 'h-20',
};

export const BrandLogo = ({ size = 'md', withText = true }: Props): JSX.Element => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    <img src={logo} alt="Arrière Plan" className={`${HEIGHTS[size]} w-auto object-contain`} />
    {withText && (
      <span className={`font-heading font-extrabold text-slate-900 leading-tight ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
        Arrière <span className="text-bronze-600">Plan</span>
      </span>
    )}
  </div>
);
