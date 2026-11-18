import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/utils';

export function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Compass aria-hidden="true" className="h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Page not found</h1>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        The page you are looking for does not exist. It may have moved, or the link may be wrong.
      </p>
      <Link to="/" className={cn(buttonVariants({ size: 'md' }), 'mt-2')}>
        Back to overview
      </Link>
    </div>
  );
}
