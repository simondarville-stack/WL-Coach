import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Dumbbell,
  BarChart3,
  Calendar,
  TrendingUp,
  LineChart,
  CalendarDays,
  Users,
  UsersRound,
  ClipboardList,
  BookOpen,
  Settings,
  ChevronsLeft,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Planning',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
      { path: '/planner', label: 'Weekly planner', icon: Calendar },
      { path: '/macrocycles', label: 'Macro cycles', icon: TrendingUp },
      { path: '/analysis', label: 'Analysis', icon: LineChart },
      { path: '/events', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'Athletes',
    items: [
      { path: '/athletes', label: 'Roster', icon: Users },
      { path: '/training-groups', label: 'Training groups', icon: UsersRound },
      { path: '/training-log', label: 'Training log', icon: ClipboardList },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/library', label: 'Exercise library', icon: BookOpen },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('winwota_sidebar_collapsed') === 'true';
  });

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('winwota_sidebar_collapsed', String(next));
  }

  return (
    <aside
      className={`flex flex-col flex-shrink-0 bg-gray-50 border-r border-gray-200 transition-all duration-150 ease-in-out overflow-hidden ${
        collapsed ? 'w-12' : 'w-[200px]'
      }`}
    >
      {/* Logo / App name */}
      <div
        className={`flex items-center gap-2 border-b border-gray-200 cursor-pointer flex-shrink-0 ${
          collapsed ? 'justify-center px-0 py-3' : 'px-3 py-3'
        }`}
        onClick={() => navigate('/dashboard')}
        title="WinWota 2.0"
      >
        <Dumbbell className="text-blue-600 flex-shrink-0" size={20} />
        {!collapsed && (
          <span className="font-medium text-sm text-gray-900 whitespace-nowrap overflow-hidden">
            WinWota 2.0
          </span>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
        {sections.map((section, sIdx) => (
          <div key={section.label}>
            {/* Section header */}
            {collapsed ? (
              sIdx > 0 && (
                <div className="mx-2 my-2 border-t border-gray-200" />
              )
            ) : (
              <div
                className={`px-4 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-widest whitespace-nowrap overflow-hidden ${
                  sIdx === 0 ? 'pt-2' : 'pt-4'
                }`}
              >
                {section.label}
              </div>
            )}

            {/* Nav items */}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-2 text-[13px] transition-colors duration-100 rounded-lg mx-1 ${
                      collapsed
                        ? 'justify-center py-2 px-0'
                        : 'py-1.5 px-3'
                    } ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        size={16}
                        className={`flex-shrink-0 ${isActive ? 'text-blue-700' : ''}`}
                      />
                      {!collapsed && (
                        <span className="whitespace-nowrap overflow-hidden">
                          {item.label}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle + version */}
      <div className="flex-shrink-0 border-t border-gray-200">
        {!collapsed && (
          <div className="px-4 pt-2 text-[10px] text-gray-300 select-none">v2.0</div>
        )}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`w-full flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors duration-100 ${
            collapsed ? 'justify-center py-2.5 px-0' : 'py-2 px-3'
          }`}
        >
          <ChevronsLeft
            size={16}
            className={`flex-shrink-0 transition-transform duration-150 ${
              collapsed ? 'rotate-180' : ''
            }`}
          />
          {!collapsed && (
            <span className="text-[13px] whitespace-nowrap overflow-hidden">
              Collapse
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
