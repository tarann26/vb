
import React from 'react';
import { ExternalLink, Calendar } from 'lucide-react';
import { press } from '../content';

const NewsPress: React.FC = () => {
  const articles = press.slice(0, 3);

  return (
    <section id="press" className="py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-6">
            In the Press
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            Discover what food critics and culinary experts are saying about Via Bianca's 
            authentic Italian experience and Chef Kamalika's innovative approach to traditional cuisine.
          </p>
        </div>

        {/* Articles Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {articles.map((article, index) => (
            <article 
              key={index}
              className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transform hover:scale-105 transition-all duration-300 overflow-hidden group"
            >
              {/* Article Image */}
              <div className="h-48 relative overflow-hidden">
                <img 
                  src={article.image}
                  alt={`${article.publication} article about Via Bianca`}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"></div>
                
                {/* Publication Badge */}
                <div className="absolute top-4 left-4">
                  <span className="bg-[#6B8B59] text-white px-3 py-1 rounded-full text-xs font-['Montserrat'] font-semibold uppercase tracking-wide">
                    {article.publication}
                  </span>
                </div>
              </div>

              {/* Article Content */}
              <div className="p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Calendar className="w-4 h-4 text-[#6B8B59]" />
                  <span className="font-['Open_Sans'] text-sm text-gray-500">{article.date}</span>
                </div>
                
                <h3 className="font-['Montserrat'] font-bold text-lg text-[#222] mb-3 leading-tight group-hover:text-[#6B8B59] transition-colors duration-300">
                  {article.title}
                </h3>
                
                <p className="font-['Open_Sans'] text-gray-600 text-sm leading-relaxed mb-4">
                  {article.excerpt}
                </p>
                
                {article.url && (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 text-[#6B8B59] hover:text-[#5a7349] font-['Montserrat'] font-semibold text-sm uppercase tracking-wide transition-colors duration-300"
                    aria-label={`Read full article: ${article.title}`}
                  >
                    <span>Read Article</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default NewsPress;
