import { supabase } from '../lib/supabase';

export function useMediaUpload() {
  const uploadMedia = async (file: File, type: 'video' | 'image'): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${type}s/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('planner-media')
      .upload(fileName, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('planner-media')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  };

  return { uploadMedia };
}
