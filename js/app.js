let currentUser = null;
let currentProfile = null;

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
  document.getElementById('user-display').textContent = displayName;
  document.getElementById('composer-avatar').textContent = displayName.charAt(0).toUpperCase();

  await loadTweets();
  setupComposer();
  setupRealtime();
}

function setupComposer() {
  const textarea = document.getElementById('tweet-input');
  const counter = document.getElementById('char-counter');
  const btn = document.getElementById('tweet-btn');

  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    counter.textContent = 280 - len;
    counter.classList.toggle('over', len > 280);
    btn.disabled = len === 0 || len > 280;
  });

  btn.addEventListener('click', postTweet);
}

async function postTweet() {
  const textarea = document.getElementById('tweet-input');
  const content = textarea.value.trim();
  if (!content) return;

  const btn = document.getElementById('tweet-btn');
  btn.disabled = true;

  const { error } = await sb.from('tweets').insert({ user_id: currentUser.id, content });
  if (error) {
    alert('投稿に失敗しました: ' + error.message);
    btn.disabled = false;
    return;
  }

  textarea.value = '';
  document.getElementById('char-counter').textContent = '280';
  await loadTweets();
}

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

  if (error) {
    console.error(error);
    return;
  }

  renderTweets(tweets);
}

function renderTweets(tweets) {
  const feed = document.getElementById('tweet-feed');

  if (tweets.length === 0) {
    feed.innerHTML = '<p class="empty-msg">まだツイートがありません。最初の投稿をしてみよう！</p>';
    return;
  }

  feed.innerHTML = tweets.map(tweet => {
    const profile = tweet.profiles;
    const name = profile?.display_name || profile?.username || '?';
    const handle = profile?.username || '?';
    const likeCount = tweet.likes?.length || 0;
    const liked = tweet.likes?.some(l => l.user_id === currentUser.id) || false;
    const isOwn = tweet.user_id === currentUser.id;
    const time = formatTime(tweet.created_at);

    return `
      <article class="tweet-card" data-id="${tweet.id}">
        <div class="tweet-avatar">${name.charAt(0).toUpperCase()}</div>
        <div class="tweet-body">
          <div class="tweet-header">
            <span class="tweet-name">${escapeHtml(name)}</span>
            <span class="tweet-handle">@${escapeHtml(handle)}</span>
            <span class="tweet-time">${time}</span>
            ${isOwn ? `<button class="delete-btn" onclick="deleteTweet('${tweet.id}')">削除</button>` : ''}
          </div>
          <p class="tweet-content">${escapeHtml(tweet.content)}</p>
          <div class="tweet-actions">
            <button class="like-btn ${liked ? 'liked' : ''}" onclick="toggleLike('${tweet.id}', ${liked})">
              ${liked ? '♥' : '♡'} <span class="like-count">${likeCount}</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function toggleLike(tweetId, isLiked) {
  if (isLiked) {
    await sb.from('likes').delete()
      .eq('user_id', currentUser.id)
      .eq('tweet_id', tweetId);
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

function setupRealtime() {
  sb.channel('public:tweets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tweets' }, () => loadTweets())
    .subscribe();
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return date.toLocaleDateString('ja-JP');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

document.getElementById('logout-btn').addEventListener('click', signOut);
init();
