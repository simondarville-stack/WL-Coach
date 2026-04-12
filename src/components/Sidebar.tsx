import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  LayoutDashboard,
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
  Calculator,
  Hash,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useCoachStore } from '../store/coachStore';
import { useAthleteStore } from '../store/athleteStore';

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
      { path: '/dashboard-v2', label: 'Dashboard V2', icon: LayoutDashboard },
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
      { path: '/prs', label: 'Personal Records', icon: Trophy },
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

interface SidebarProps {
  onNewCoach?: () => void;
  onOpenCalc?: () => void;
  onOpenCalculator?: () => void;
  onOpenCalendarTool?: () => void;
}

export function Sidebar({ onNewCoach, onOpenCalc, onOpenCalculator, onOpenCalendarTool }: SidebarProps) {
  const navigate = useNavigate();
  const { activeCoach, coaches, setActiveCoach } = useCoachStore();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('emos_sidebar_collapsed') === 'true';
  });

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('emos_sidebar_collapsed', String(next));
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
        title="EMOS"
      >
        {!collapsed ? (
          <span className="text-[22px] font-black tracking-[0.15em] text-gray-900 uppercase leading-none" style={{ fontFamily: 'Arial Black, Impact, Helvetica, sans-serif' }}>
            EMOS
          </span>
        ) : (
          <span className="text-[16px] font-black tracking-tight text-gray-900 uppercase leading-none" style={{ fontFamily: 'Arial Black, Impact, Helvetica, sans-serif' }}>
            E
          </span>
        )}
      </div>

      {/* Environment switcher */}
      {!collapsed && (
        <div className="px-3 py-2.5 border-b border-gray-200 flex-shrink-0">
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">
            Environment
          </div>
          <select
            value={activeCoach?.id ?? ''}
            onChange={(e) => {
              const coach = coaches.find(c => c.id === e.target.value);
              if (coach) {
                setActiveCoach(coach);
                useAthleteStore.getState().setSelectedAthlete(null);
                window.location.reload();
              }
            }}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5
                       bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {coaches.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.club_name ? ` — ${c.club_name}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => onNewCoach?.()}
            className="w-full mt-1.5 text-[10px] text-blue-600 hover:text-blue-700 text-left px-1"
          >
            + New environment
          </button>
        </div>
      )}

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
                    `w-full flex items-center gap-2 text-[13px] rounded-lg mx-1 transition-all duration-100 ${
                      collapsed
                        ? 'justify-center py-2 px-0'
                        : 'py-1.5 px-3'
                    } ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium shadow-sm shadow-blue-100/50'
                        : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900'
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

      {/* Tools section */}
      <div className="flex-shrink-0 border-t border-gray-200 py-1">
        {!collapsed && (
          <div className="px-4 pb-1 pt-3 text-[10px] font-medium text-gray-400 uppercase tracking-widest whitespace-nowrap overflow-hidden">
            Tools
          </div>
        )}
        {collapsed && <div className="mx-2 my-2 border-t border-gray-200" />}
        <button
          onClick={() => onOpenCalc?.()}
          title={collapsed ? 'xRM Calculator' : undefined}
          className={`w-full flex items-center gap-2 text-[13px] transition-colors duration-100 rounded-lg mx-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 ${
            collapsed ? 'justify-center py-2 px-0' : 'py-1.5 px-3'
          }`}
        >
          <Calculator size={16} className="flex-shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap overflow-hidden">xRM Calculator</span>
          )}
        </button>
        <button
          onClick={() => onOpenCalculator?.()}
          title={collapsed ? 'Calculator' : undefined}
          className={`w-full flex items-center gap-2 text-[13px] transition-colors duration-100 rounded-lg mx-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 ${
            collapsed ? 'justify-center py-2 px-0' : 'py-1.5 px-3'
          }`}
        >
          <Hash size={16} className="flex-shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap overflow-hidden">Calculator</span>
          )}
        </button>
        <button
          onClick={() => onOpenCalendarTool?.()}
          title={collapsed ? 'Calendar' : undefined}
          className={`w-full flex items-center gap-2 text-[13px] transition-colors duration-100 rounded-lg mx-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 ${
            collapsed ? 'justify-center py-2 px-0' : 'py-1.5 px-3'
          }`}
        >
          <CalendarDays size={16} className="flex-shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap overflow-hidden">Calendar</span>
          )}
        </button>
      </div>

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
