import { cn } from '@/lib/cn';

interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: number;
  // Rounded square instead of a circle — used for project logos.
  square?: boolean;
}

// Avatar — photo if present, otherwise initials on a neutral surface. Circular
// by default; `square` renders a rounded square (project logos).
export const Avatar = ({ name, photoUrl, size = 36, square = false }: AvatarProps) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

  return (
    <div
      className={cn(
        'overflow-hidden flex items-center justify-center flex-shrink-0',
        square ? 'rounded-lg' : 'rounded-full',
        'bg-surface-hover border border-border text-text-secondary font-medium',
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials || '?'}</span>
      )}
    </div>
  );
};
