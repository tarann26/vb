import React, { useState } from 'react';
import { ExternalLink, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import { formatArticleDate } from '../content/article-date';

const BlogsPage: React.FC = () => {
  const navigate = useNavigate();
  const content = useContent();
  const { press, copy } = content;
  const [currentPage, setCurrentPage] = useState(1);
  const articlesPerPage = 10;

  // Calculate pagination. press.json is already sorted newest first at source.
  const totalPages = Math.ceil(press.length / articlesPerPage);
  const startIndex = (currentPage - 1) * articlesPerPage;
  const currentArticles = press.slice(startIndex, startIndex + articlesPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <h1 className="font-['Parisienne'] text-4xl text-[#222] mb-2">{content.renderText('blogsPage.title', copy.blogsPage.title)}</h1>
              <p className="font-['Montserrat'] text-[#6B8B59] text-sm uppercase tracking-wider">
                {content.renderText('blogsPage.subtitle', copy.blogsPage.subtitle)}
              </p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="text-[#6B8B59] hover:text-[#222] font-['Montserrat'] text-sm uppercase tracking-wide transition-colors duration-300"
            >
              {content.renderText('blogsPage.back', copy.blogsPage.back)}
            </button>
          </div>
        </div>
      </div>

      {/* Articles Section */}
      <div className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-6">
              {content.renderText('blogsPage.heading', copy.blogsPage.heading)}
            </h2>
            <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
              {content.renderText('blogsPage.intro', copy.blogsPage.intro)}
            </p>
          </div>

          {/* Articles Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
            {currentArticles.map((article, index) => (
              <article 
                key={startIndex + index}
                className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transform hover:scale-105 transition-all duration-300 overflow-hidden group"
              >
                {/* Article Image */}
                <div className="h-48 relative overflow-hidden">
                  {content.renderImage(`press.${article.id}.image`, {
                    src: article.image,
                    alt: `${article.publication} article about Via Bianca`,
                    className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
                    loading: 'lazy',
                  })}
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
                    <span className="font-['Open_Sans'] text-sm text-gray-500">
                      {formatArticleDate(article.date)}
                    </span>
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
                      <span>{content.renderText('press.readArticle', copy.press.readArticle)}</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center space-x-4">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="font-['Montserrat'] text-sm">{content.renderText('blogsPage.previous', copy.blogsPage.previous)}</span>
              </button>

              <div className="flex space-x-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`px-4 py-2 rounded-lg font-['Montserrat'] text-sm transition-colors duration-300 ${
                      currentPage === page
                        ? 'bg-[#6B8B59] text-white'
                        : 'bg-white border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
              >
                <span className="font-['Montserrat'] text-sm">{content.renderText('blogsPage.next', copy.blogsPage.next)}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlogsPage;