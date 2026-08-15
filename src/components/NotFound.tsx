import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';

const NotFound: React.FC = () => {
  const content = useContent();
  const { site, copy } = content;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cream-alt px-6 text-center">
      <h1 className="font-['Parisienne'] text-5xl text-ink mb-2">{site.name}</h1>
      <h2 className="font-['Montserrat'] text-lg uppercase tracking-wide text-brand mb-6">
        {content.renderText('notFound.heading', copy.notFound.heading)}
      </h2>
      <Link
        to="/"
        className="bg-brand hover:bg-brand-dark text-ink px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide transition-colors duration-300"
      >
        {content.renderText('notFound.back', copy.notFound.back)}
      </Link>
    </div>
  );
};

export default NotFound;
