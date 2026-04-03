import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Plus, Edit2, Trash2, Save, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useExercises, type Category } from '../hooks/useExercises';

interface SettingsProps {
  embedded?: boolean;
}

export function Settings({ embedded = false }: SettingsProps) {
  const {
    categories, loading, error, setError,
    fetchCategoriesWithError,
    createCategory, updateCategory, deleteCategory, swapCategoryOrder,
  } = useExercises();

  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchCategoriesWithError();
  }, []);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const maxOrder = Math.max(...categories.map((c) => c.display_order), 0);
      await createCategory(newCategoryName.trim(), maxOrder + 1);
      setNewCategoryName('');
      await fetchCategoriesWithError();
    } catch {
      // error already set in hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await updateCategory(editingCategory.id, editingCategory.name.trim());
      setEditingCategory(null);
      await fetchCategoriesWithError();
    } catch {
      // error already set in hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
    if (!confirm(`Are you sure you want to delete the category "${categoryName}"? This cannot be undone.`)) return;

    setError(null);
    try {
      await deleteCategory(categoryId);
      await fetchCategoriesWithError();
    } catch {
      // error already set in hook
    }
  };

  const handleMoveCategory = async (category: Category, direction: 'up' | 'down') => {
    const currentIndex = categories.findIndex((c) => c.id === category.id);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === categories.length - 1) return;

    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const swapCategory = categories[swapIndex];

    setError(null);
    try {
      await swapCategoryOrder(category.id, swapCategory.display_order, swapCategory.id, category.display_order);
      await fetchCategoriesWithError();
    } catch {
      // error already set in hook
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        {!embedded && (
          <div className="flex items-center gap-3 mb-6">
            <SettingsIcon className="text-blue-600" size={28} />
            <h1 className="text-2xl font-medium text-gray-900">Settings</h1>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-8">
          <div>
            <h2 className={`${embedded ? 'text-base' : 'text-lg'} font-medium text-gray-800 mb-4`}>
              Exercise Categories
            </h2>
            <p className="text-gray-600 mb-6">
              Manage the categories used to organize exercises in your library.
            </p>

            <form onSubmit={handleAddCategory} className="mb-6">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSubmitting}
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !newCategoryName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Plus size={18} />
                  Add Category
                </button>
              </div>
            </form>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">Loading categories...</div>
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg">No categories yet. Add your first category above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((category, index) => (
                  <div
                    key={category.id}
                    className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleMoveCategory(category, 'up')}
                        disabled={index === 0}
                        className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        onClick={() => handleMoveCategory(category, 'down')}
                        disabled={index === categories.length - 1}
                        className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move down"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>

                    {editingCategory?.id === category.id ? (
                      <>
                        <input
                          type="text"
                          value={editingCategory.name}
                          onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                          className="flex-1 px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button
                          onClick={handleUpdateCategory}
                          disabled={isSubmitting || !editingCategory.name.trim()}
                          className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                          title="Save"
                        >
                          <Save size={18} />
                        </button>
                        <button
                          onClick={() => setEditingCategory(null)}
                          disabled={isSubmitting}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          title="Cancel"
                        >
                          <X size={18} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-medium text-gray-900">{category.name}</span>
                        <button
                          onClick={() => setEditingCategory(category)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category.id, category.name)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
