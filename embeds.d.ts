export type EmbedBadge = { text: string };

export type CompactEmbed = {
  type: "compact";
  /** nonblank inline Markdown or text, up to 1024 unicode code points */
  content: string;
  /** absolute HTTP(S) URL, up to 2048 characters, without credentials */
  link?: string;
  /** #RRGGBB accent */
  color?: string;
  /** plain content label, up to 32 characters; never a trusted identity */
  badge?: EmbedBadge;
};

export type RichEmbed = {
  type: "rich";
  title?: string;
  description?: string;
  footer?: string;
  color?: string;
  url?: string;
  image_url?: string;
  video_url?: string;
  audio_url?: string;
};

export type Embed = RichEmbed | CompactEmbed;

export type MessagePayload = {
  content?: string;
  embeds?: Embed[];
  file_ids?: string[];
  nonce?: string;
  reply_to_id?: string;
};
