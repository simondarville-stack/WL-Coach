import { useState, useEffect } from 'react';
import { X, Video, Trash2, Plus, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Athlete, EventAttempts, EventVideo } from '../lib/database.types';

interface EventAttemptsModalProps {
  eventId: string;
  eventName: string;
  athlete: Athlete;
  onClose: () => void;
  onSave: () => void;
}

export function EventAttemptsModal({ eventId, eventName, athlete, onClose, onSave }: EventAttemptsModalProps) {
  const [attempts, setAttempts] = useState<EventAttempts | null>(null);
  const [videos, setVideos] = useState<EventVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'planned' | 'actual'>('planned');
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<'url' | 'file'>('url');
  const [uploading, setUploading] = useState(false);
  const [videoForm, setVideoForm] = useState({
    lift_type: 'snatch' as 'snatch' | 'clean_jerk',
    attempt_number: 1,
    video_url: '',
    description: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    loadData();
  }, [eventId, athlete.id]);

  async function loadData() {
    try {
      setLoading(true);

      const { data: attemptsData } = await supabase
        .from('event_attempts')
        .select('*')
        .eq('event_id', eventId)
        .eq('athlete_id', athlete.id)
        .maybeSingle();

      if (attemptsData) {
        setAttempts(attemptsData);
      } else {
        setAttempts({
          id: '',
          event_id: eventId,
          athlete_id: athlete.id,
          planned_snatch_1: null,
          planned_snatch_2: null,
          planned_snatch_3: null,
          planned_cj_1: null,
          planned_cj_2: null,
          planned_cj_3: null,
          actual_snatch_1: null,
          actual_snatch_2: null,
          actual_snatch_3: null,
          actual_cj_1: null,
          actual_cj_2: null,
          actual_cj_3: null,
          competition_notes: null,
          created_at: '',
          updated_at: '',
        });
      }

      const { data: videosData } = await supabase
        .from('event_videos')
        .select('*')
        .eq('event_id', eventId)
        .eq('athlete_id', athlete.id)
        .order('lift_type')
        .order('attempt_number');

      setVideos(videosData || []);
    } catch (error) {
      console.error('Error loading attempts:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!attempts) return;

    try {
      if (attempts.id && attempts.id !== '') {
        await supabase
          .from('event_attempts')
          .update({
            planned_snatch_1: attempts.planned_snatch_1,
            planned_snatch_2: attempts.planned_snatch_2,
            planned_snatch_3: attempts.planned_snatch_3,
            planned_cj_1: attempts.planned_cj_1,
            planned_cj_2: attempts.planned_cj_2,
            planned_cj_3: attempts.planned_cj_3,
            actual_snatch_1: attempts.actual_snatch_1,
            actual_snatch_2: attempts.actual_snatch_2,
            actual_snatch_3: attempts.actual_snatch_3,
            actual_cj_1: attempts.actual_cj_1,
            actual_cj_2: attempts.actual_cj_2,
            actual_cj_3: attempts.actual_cj_3,
            competition_notes: attempts.competition_notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', attempts.id);
      } else {
        const { data, error } = await supabase.from('event_attempts').insert({
          event_id: eventId,
          athlete_id: athlete.id,
          planned_snatch_1: attempts.planned_snatch_1,
          planned_snatch_2: attempts.planned_snatch_2,
          planned_snatch_3: attempts.planned_snatch_3,
          planned_cj_1: attempts.planned_cj_1,
          planned_cj_2: attempts.planned_cj_2,
          planned_cj_3: attempts.planned_cj_3,
          actual_snatch_1: attempts.actual_snatch_1,
          actual_snatch_2: attempts.actual_snatch_2,
          actual_snatch_3: attempts.actual_snatch_3,
          actual_cj_1: attempts.actual_cj_1,
          actual_cj_2: attempts.actual_cj_2,
          actual_cj_3: attempts.actual_cj_3,
          competition_notes: attempts.competition_notes,
        }).select();

        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving attempts:', error);
      alert('Failed to save attempts. Please try again.');
    }
  }

  async function handleFileUpload() {
    if (!selectedFile) return;

    try {
      setUploading(true);

      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${eventId}/${athlete.id}/${videoForm.lift_type}_${videoForm.attempt_number}_${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('event-videos')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('event-videos')
        .getPublicUrl(fileName);

      await supabase.from('event_videos').insert({
        event_id: eventId,
        athlete_id: athlete.id,
        lift_type: videoForm.lift_type,
        attempt_number: videoForm.attempt_number,
        video_url: publicUrlData.publicUrl,
        description: videoForm.description || null,
      });

      setVideoForm({
        lift_type: 'snatch',
        attempt_number: 1,
        video_url: '',
        description: '',
      });
      setSelectedFile(null);
      setShowVideoForm(false);
      loadData();
    } catch (error) {
      console.error('Error uploading video:', error);
      alert('Failed to upload video. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleAddVideoUrl() {
    if (!videoForm.video_url.trim()) return;

    try {
      await supabase.from('event_videos').insert({
        event_id: eventId,
        athlete_id: athlete.id,
        lift_type: videoForm.lift_type,
        attempt_number: videoForm.attempt_number,
        video_url: videoForm.video_url,
        description: videoForm.description || null,
      });

      setVideoForm({
        lift_type: 'snatch',
        attempt_number: 1,
        video_url: '',
        description: '',
      });
      setShowVideoForm(false);
      loadData();
    } catch (error) {
      console.error('Error adding video:', error);
    }
  }

  async function handleAddVideo() {
    if (uploadMethod === 'file') {
      await handleFileUpload();
    } else {
      await handleAddVideoUrl();
    }
  }

  async function handleDeleteVideo(videoId: string, videoUrl: string) {
    if (!confirm('Delete this video?')) return;

    try {
      if (videoUrl.includes('event-videos')) {
        const urlParts = videoUrl.split('/event-videos/');
        if (urlParts.length > 1) {
          const filePath = urlParts[1].split('?')[0];
          await supabase.storage.from('event-videos').remove([filePath]);
        }
      }

      await supabase.from('event_videos').delete().eq('id', videoId);
      loadData();
    } catch (error) {
      console.error('Error deleting video:', error);
    }
  }

  function updateAttempt(field: keyof EventAttempts, value: string) {
    if (!attempts) return;

    const numValue = value === '' ? null : parseInt(value);
    setAttempts({ ...attempts, [field]: numValue });
  }

  function renderAttemptInput(label: string, field: keyof EventAttempts, isActual = false) {
    const value = attempts?.[field] as number | null;
    const displayValue = value === null ? '' : Math.abs(value).toString();
    const isFailed = isActual && value !== null && value < 0;

    return (
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 w-20">{label}</label>
        <input
          type="number"
          value={displayValue}
          onChange={(e) => {
            const inputVal = e.target.value;
            if (isActual && isFailed) {
              updateAttempt(field, inputVal === '' ? '' : `-${inputVal}`);
            } else {
              updateAttempt(field, inputVal);
            }
          }}
          className="w-24 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="kg"
        />
        {isActual && (
          <label className="flex items-center gap-1 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={isFailed}
              onChange={(e) => {
                const currentValue = Math.abs(value || 0);
                if (currentValue === 0) return;
                updateAttempt(field, e.target.checked ? `-${currentValue}` : `${currentValue}`);
              }}
              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            Failed
          </label>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{eventName}</h2>
            <p className="text-sm text-gray-600">{athlete.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="flex gap-2 mb-6 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('planned')}
              className={`px-4 py-2 font-medium border-b-2 ${
                activeTab === 'planned'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Planned Attempts
            </button>
            <button
              onClick={() => setActiveTab('actual')}
              className={`px-4 py-2 font-medium border-b-2 ${
                activeTab === 'actual'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Actual Results
            </button>
          </div>

          {activeTab === 'planned' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Snatch</h3>
                <div className="space-y-2 pl-4">
                  {renderAttemptInput('1st', 'planned_snatch_1')}
                  {renderAttemptInput('2nd', 'planned_snatch_2')}
                  {renderAttemptInput('3rd', 'planned_snatch_3')}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Clean & Jerk</h3>
                <div className="space-y-2 pl-4">
                  {renderAttemptInput('1st', 'planned_cj_1')}
                  {renderAttemptInput('2nd', 'planned_cj_2')}
                  {renderAttemptInput('3rd', 'planned_cj_3')}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'actual' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Snatch</h3>
                <div className="space-y-2 pl-4">
                  {renderAttemptInput('1st', 'actual_snatch_1', true)}
                  {renderAttemptInput('2nd', 'actual_snatch_2', true)}
                  {renderAttemptInput('3rd', 'actual_snatch_3', true)}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Clean & Jerk</h3>
                <div className="space-y-2 pl-4">
                  {renderAttemptInput('1st', 'actual_cj_1', true)}
                  {renderAttemptInput('2nd', 'actual_cj_2', true)}
                  {renderAttemptInput('3rd', 'actual_cj_3', true)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Competition Notes</label>
                <textarea
                  value={attempts?.competition_notes || ''}
                  onChange={(e) =>
                    setAttempts(attempts ? { ...attempts, competition_notes: e.target.value } : null)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  placeholder="Notes about the competition performance..."
                />
              </div>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Videos</h3>
              <button
                onClick={() => setShowVideoForm(!showVideoForm)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                Add Video
              </button>
            </div>

            {showVideoForm && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lift Type</label>
                    <select
                      value={videoForm.lift_type}
                      onChange={(e) =>
                        setVideoForm({ ...videoForm, lift_type: e.target.value as 'snatch' | 'clean_jerk' })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="snatch">Snatch</option>
                      <option value="clean_jerk">Clean & Jerk</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Attempt</label>
                    <select
                      value={videoForm.attempt_number}
                      onChange={(e) => setVideoForm({ ...videoForm, attempt_number: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1}>1st</option>
                      <option value={2}>2nd</option>
                      <option value={3}>3rd</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 border-b border-gray-300">
                  <button
                    onClick={() => {
                      setUploadMethod('url');
                      setSelectedFile(null);
                    }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${
                      uploadMethod === 'url'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    URL
                  </button>
                  <button
                    onClick={() => {
                      setUploadMethod('file');
                      setVideoForm({ ...videoForm, video_url: '' });
                    }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${
                      uploadMethod === 'file'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Upload File
                  </button>
                </div>

                {uploadMethod === 'url' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Video URL</label>
                    <input
                      type="url"
                      value={videoForm.video_url}
                      onChange={(e) => setVideoForm({ ...videoForm, video_url: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Upload Video File</label>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-md hover:border-gray-400 cursor-pointer bg-white">
                        <Upload className="w-5 h-5 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {selectedFile ? selectedFile.name : 'Choose video file...'}
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                      {selectedFile && (
                        <button
                          onClick={() => setSelectedFile(null)}
                          className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Supports MP4, MOV, AVI, and other video formats (max 100MB)
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    value={videoForm.description}
                    onChange={(e) => setVideoForm({ ...videoForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Good technique, slight miss forward"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddVideo}
                    disabled={uploading || (uploadMethod === 'url' ? !videoForm.video_url.trim() : !selectedFile)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? 'Uploading...' : uploadMethod === 'file' ? 'Upload Video' : 'Add Video'}
                  </button>
                  <button
                    onClick={() => {
                      setShowVideoForm(false);
                      setSelectedFile(null);
                      setVideoForm({ lift_type: 'snatch', attempt_number: 1, video_url: '', description: '' });
                    }}
                    disabled={uploading}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {videos.map((video) => {
                const isUploadedFile = video.video_url.includes('event-videos');
                return (
                  <div key={video.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <Video className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {video.lift_type === 'snatch' ? 'Snatch' : 'Clean & Jerk'} - Attempt {video.attempt_number}
                        {isUploadedFile && (
                          <span className="ml-2 text-xs text-green-600 font-normal">(Uploaded)</span>
                        )}
                      </div>
                      {video.description && (
                        <div className="text-xs text-gray-600 mt-0.5">{video.description}</div>
                      )}
                      <a
                        href={video.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-700 truncate block mt-1"
                      >
                        {isUploadedFile ? 'View uploaded video' : video.video_url}
                      </a>
                    </div>
                    <button
                      onClick={() => handleDeleteVideo(video.id, video.video_url)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
              {videos.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No videos added yet</div>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
