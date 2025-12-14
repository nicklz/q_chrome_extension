document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('shreddit-ad-post').forEach(el => el.style.display = 'none');

    console.error('redditcom.js has been loaded');

    let state = getState();
    console.log("State object:", state);

    // Query all "Reply" spans and log them
    console.log("Querying DOM for 'Reply' spans...");
    let replies = document.querySelectorAll('span');
    console.log("Found spans:", replies);

    replies.forEach(span => {
        if (span.textContent.trim() === 'Reply') {
            console.log("Clicking reply span:", span);
            span.click();
        }
    });

    setTimeout(() => {
        // Query all textareas with 'Reply' aria-placeholder and log them
        console.log("Querying DOM for 'Reply' textareas...");
        let textAreas = document.querySelectorAll('textarea[aria-placeholder="Reply"]');
        console.log("Found textareas:", textAreas);

        textAreas.forEach(area => {
            if (typeof state.prompt !== 'undefined' && state.prompt) {
                console.log("Filling textarea with prompt:", state.prompt);
                area.value = state.prompt;

                // Dispatch input event to ensure React detects change
                let inputEvent = new Event('input', { bubbles: true });
                area.dispatchEvent(inputEvent);

                let commentBtn = area.closest('form')?.querySelector('button[type="submit"]');
                if (commentBtn) {
                    console.log("Clicking submit button:", commentBtn);
                    commentBtn.click();
                } else {
                    console.warn("Submit button not found for textarea:", area);
                }
            }
        });
    }, 1500); // Increased timeout for better reliability

    setTimeout(() => {
        // Query all comments and log them
        console.log("Querying DOM for comment content...");
        let comments = document.querySelectorAll('span[slot="content"]');
        console.log("Found comments:", comments);

        comments.forEach(comment => {
            console.log("Comment text:", comment.textContent.trim());
        });
    }, 2000);
});
