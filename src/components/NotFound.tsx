import { Link } from 'react-router-dom';
import { site, copy } from '../content';

const NotFound: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F9F9] px-6 text-center">
    <h1 className="font-['Parisienne'] text-5xl text-[#222] mb-2">{site.name}</h1>
    <h2 className="font-['Montserrat'] text-lg uppercase tracking-wide text-[#6B8B59] mb-6">
      {copy.notFound.heading}
    </h2>
    <Link
      to="/"
      className="bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide transition-colors duration-300"
    >
      {copy.notFound.back}
    </Link>
  </div>
);

export default NotFound;
