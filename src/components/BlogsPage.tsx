import React, { useState } from 'react';
import { ExternalLink, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const BlogsPage: React.FC = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const articlesPerPage = 10;

  // Extended articles list with more entries
  const allArticles = [
    {
      title: "Via Bianca Brings Regional Italian Flair to Delhi's Dining Scene",
      publication: "BW Hotelier",
      date: "2024-12-15",
      excerpt: "Chef Kamalika Anand's latest venture showcases authentic Puglian cuisine with handcrafted pastas and zero-proof cocktails.",
      url: "https://www.bwhotelier.com/article/via-bianca-brings-regional-italian-flair-to-delhis-dining-scene-558510",
      image: "/public/press/hotelier.png"
    },
    {
      title: "Via Bianca Pastificio & Ristorante Delhi",
      publication: "Delhi Royale",
      date: "2024-12-10",
      excerpt: "A deep dive into the authentic Italian dining experience that's capturing hearts in Greater Kailash.",
      url: "https://www.delhiroyale.in/post/via-bianca-pastificio-ristorante-delhi",
      image: "/public/press/royale.png"
    },
    {
      title: "Le Cordon Bleu Alum Chef Kamalika Anand Debuts Via Bianca in Delhi",
      publication: "Restaurant India",
      date: "2024-12-05",
      excerpt: "From Michelin-starred kitchens to Delhi's dining scene, Chef Kamalika brings her expertise to Via Bianca.",
      url: "https://www.restaurantindia.in/news/le-cordon-bleu-alum-chef-kamalika-anand-debuts-via-bianca-in-delhi.n12908",
      image: "/public/press/restaurantindia.png"
    },
    {
      title: "The Art of Handmade Pasta: Via Bianca's Traditional Approach",
      publication: "Food & Wine India",
      date: "2024-11-28",
      excerpt: "Exploring the traditional pasta-making techniques that make Via Bianca's dishes truly authentic.",
      url: "#",
      image: "/public/food/aglio.jpg"
    },
    {
      title: "Zero-Proof Cocktails: The Future of Italian Dining",
      publication: "Mixology Magazine",
      date: "2024-11-20",
      excerpt: "How Via Bianca is revolutionizing the mocktail scene with Italian-inspired zero-proof beverages.",
      url: "#",
      image: "/public/food/bicerin.jpg"
    },
    {
      title: "From Puglia to Delhi: A Culinary Journey",
      publication: "Travel + Leisure India",
      date: "2024-11-15",
      excerpt: "Chef Kamalika Anand brings the authentic flavors of Southern Italy to the heart of Delhi.",
      url: "#",
      image: "/public/food/tielle.jpg"
    },
    {
      title: "The Perfect Tiramisu: Secrets from Via Bianca's Kitchen",
      publication: "Dessert Today",
      date: "2024-11-08",
      excerpt: "Unveiling the techniques behind Via Bianca's award-winning tiramisu recipe.",
      url: "#",
      image: "/public/food/tiramisu.jpg"
    },
    {
      title: "Sustainable Italian Dining in Delhi",
      publication: "Green Restaurant Guide",
      date: "2024-10-30",
      excerpt: "How Via Bianca combines authentic Italian cuisine with sustainable practices.",
      url: "#",
      image: "/public/food/margarita.jpg"
    },
    {
      title: "The Rise of Regional Italian Cuisine in India",
      publication: "Culinary Trends",
      date: "2024-10-22",
      excerpt: "Via Bianca leads the movement bringing regional Italian specialties to Indian diners.",
      url: "#",
      image: "/public/food/assassina.jpg"
    },
    {
      title: "Chef Kamalika's Journey: From Le Cordon Bleu to Delhi",
      publication: "Chef's Table",
      date: "2024-10-15",
      excerpt: "An exclusive interview with Chef Kamalika Anand about her culinary philosophy and journey.",
      url: "#",
      image: "/public/team/alice.jpg"
    },
    {
      title: "Wood-Fired Pizza: The Italian Way at Via Bianca",
      publication: "Pizza Today",
      date: "2024-10-08",
      excerpt: "Exploring the traditional wood-fired techniques that create Via Bianca's perfect pizzas.",
      url: "#",
      image: "/public/food/margarita.jpg"
    },
    {
      title: "The Perfect Pairing: Italian Food and Zero-Proof Cocktails",
      publication: "Beverage Industry",
      date: "2024-09-30",
      excerpt: "How Via Bianca creates perfect harmony between food and non-alcoholic beverages.",
      url: "#",
      image: "/public/food/bicerin.jpg"
    }
  ];

  // Sort articles by date (newest first)
  const sortedArticles = allArticles.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Calculate pagination
  const totalPages = Math.ceil(sortedArticles.length / articlesPerPage);
  const startIndex = (currentPage - 1) * articlesPerPage;
  const currentArticles = sortedArticles.slice(startIndex, startIndex + articlesPerPage);

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
              <h1 className="font-['Parisienne'] text-4xl text-[#222] mb-2">Via Bianca Stories</h1>
              <p className="font-['Montserrat'] text-[#6B8B59] text-sm uppercase tracking-wider">
                Press & Articles
              </p>
            </div>
            <button 
              onClick={() => navigate('/')}
              className="text-[#6B8B59] hover:text-[#222] font-['Montserrat'] text-sm uppercase tracking-wide transition-colors duration-300"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>

      {/* Articles Section */}
      <div className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-6">
              All Stories
            </h2>
            <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
              Discover the complete collection of articles, reviews, and features about Via Bianca's 
              culinary journey and authentic Italian dining experience.
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
                    <span className="font-['Open_Sans'] text-sm text-gray-500">
                      {new Date(article.date).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </span>
                  </div>
                  
                  <h3 className="font-['Montserrat'] font-bold text-lg text-[#222] mb-3 leading-tight group-hover:text-[#6B8B59] transition-colors duration-300">
                    {article.title}
                  </h3>
                  
                  <p className="font-['Open_Sans'] text-gray-600 text-sm leading-relaxed mb-4">
                    {article.excerpt}
                  </p>
                  
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
                <span className="font-['Montserrat'] text-sm">Previous</span>
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
                <span className="font-['Montserrat'] text-sm">Next</span>
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