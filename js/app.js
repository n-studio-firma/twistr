let currentUser = null;
let currentProfile = null;

/* ── Avatar color: deterministic from string ── */
function avatarClass(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return 'av-' + (Math.abs(hash) % 6);
}

/* ── SVG ring counter ── */
const CIRCUMFERENCE = 69.1; // 2π × r(11)

function updateRing(len) {
  const ring    = document.getElementById('char-ring-fg');
  const label   = document.getElementById('char-counter');
  const btn     = document.getElementById('tweet-btn');
  const remain  = 280 - len;
  const ratio   = Math.min(len / 280, 1);
  const offset  = CIRCUMFERENCE * (1 - ratio);

  ring.style.strokeDashoffset = offset;
  ring.classList.toggle('warn', len > 240 && len <= 280);
  ring.classList.toggle('over', len > 280);

  label.textContent = len > 240 ? remain : '';
  btn.disabled = len === 0 || len > 280;
}

/* ── Init ── */
async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  currentProfile = profile;

  const displayName = profile?.display_name || profile?.username || currentUser.email;
  const handle      = profile?.username || currentUser.email.split('@')[0];
  const avClass     = avatarClass(handle);
  const initial     = displayName.charAt(0).toUpperCase();

  // Header / sidebar
  document.getElementById('user-display').textContent = displayName;
  document.getElementById('user-handle').textContent  = '@' + handle;

  // Sidebar avatar
  const sideAvEl = document.getElementById('sidebar-avatar');
  sideAvEl.textContent = initial;
  sideAvEl.className   = 'sidebar-avatar ' + avClass;

  // Composer avatar
  const compAvEl = document.getElementById('composer-avatar');
  compAvEl.textContent = initial;
  compAvEl.className   = 'composer-avatar ' + avClass;

  updateRing(0);
  await loadTweets();
  setupComposer();
  setupRealtime();
}

/* ── Composer ── */
function setupComposer() {
  const textarea = document.getElementById('tweet-input');
  textarea.addEventListener('input', () => updateRing(textarea.value.length));
  document.getElementById('tweet-btn').addEventListener('click', postTweet);
}

async function postTweet() {
  const textarea = document.getElementById('tweet-input');
  const content  = textarea.value.trim();
  if (!content) return;

  const btn    = document.getElementById('tweet-btn');
  btn.disabled = true;
  btn.textContent = '投稿中…';

  const { error } = await sb.from('tweets').insert({ user_id: currentUser.id, content });

  if (error) {
    alert('投稿に失敗しました: ' + error.message);
    btn.textContent = '投稿する';
    updateRing(textarea.value.length);
    return;
  }

  textarea.value = '';
  btn.textContent = '投稿する';
  updateRing(0);
  await loadTweets();
}

/* ── Feed ── */
async function loadTweets() {
  const { data: tweets, error } = await sb
    .from('tweets')
    .select(`
      id, content, created_at, user_id,
      profiles ( username, display_name ),
      likes ( id, user_id )
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { console.error(error); return; }
  renderTweets(tweets);
}

function renderTweets(tweets) {
  const feed = document.getElementById('tweet-feed');

  if (!tweets || tweets.length === 0) {
    feed.innerHTML = `
      <p class="empty-msg">
        <span class="empty-icon">✦</span>
        まだ投稿がありません。<br>最初の一言を発信してみよう！
      </p>`;
    return;
  }

  feed.innerHTML = tweets.map(tweet => {
    const profile   = tweet.profiles;
    const name      = profile?.display_name || profile?.username || '?';
    const handle    = profile?.username || '?';
    const likeCount = tweet.likes?.length || 0;
    const liked     = tweet.likes?.some(l => l.user_id === currentUser.id) || false;
    const isOwn     = tweet.user_id === currentUser.id;
    const avClass   = avatarClass(handle);

    return `
      <article class="tweet-card" data-id="${tweet.id}">
        <div class="tweet-avatar ${avClass}">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div class="tweet-body">
          <div class="tweet-header">
            <span class="tweet-name">${escapeHtml(name)}</span>
            <span class="tweet-handle">@${escapeHtml(handle)}</span>
            <span class="tweet-dot">·</span>
            <span class="tweet-time">${formatTime(tweet.created_at)}</span>
            ${isOwn ? `<button class="tweet-delete" onclick="deleteTweet('${tweet.id}')">削除</button>` : ''}
          </div>
          <p class="tweet-content">${escapeHtml(tweet.content)}</p>
          <div class="tweet-actions">
            <button class="like-btn ${liked ? 'liked' : ''}" onclick="toggleLike('${tweet.id}', ${liked})">
              <span class="like-icon">${liked ? '♥' : '♡'}</span>
              <span>${likeCount}</span>
            </button>
          </div>
        </div>
      </article>`;
  }).join('');
}

/* ── Like / Delete ── */
async function toggleLike(tweetId, isLiked) {
  if (isLiked) {
    await sb.from('likes').delete().eq('user_id', currentUser.id).eq('tweet_id', tweetId);
  } else {
    await sb.from('likes').insert({ user_id: currentUser.id, tweet_id: tweetId });
  }
  await loadTweets();
}

async function deleteTweet(tweetId) {
  if (!confirm('このツイートを削除しますか？')) return;
  await sb.from('tweets').delete().eq('id', tweetId);
  await loadTweets();
}

/* ── Realtime ── */
function setupRealtime() {
  sb.channel('public:tweets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tweets' }, () => loadTweets())
    .subscribe();
}

/* ── Helpers ── */
function formatTime(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 60)    return `${diff}秒前`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return new Date(isoString).toLocaleDateString('ja-JP');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ── Boot ── */
document.getElementById('logout-btn').addEventListener('click', signOut);
init();
