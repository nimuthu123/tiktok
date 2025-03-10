const express = require('express');
const axios = require('axios');
const app = express();
const port = 3001;

app.use(express.static('public'));
app.use(express.json());

// Helper function to clean TikTok URL
function cleanTikTokUrl(url) {
    // Remove everything after the first question mark
    url = url.split('?')[0];
    
    // Remove trailing slashes
    url = url.replace(/\/$/, '');
    
    // Convert mobile URLs to web URLs
    url = url.replace('vm.tiktok.com', 'www.tiktok.com');
    url = url.replace('vt.tiktok.com', 'www.tiktok.com');
    
    // Ensure it's a TikTok URL
    if (!url.includes('tiktok.com')) {
        throw new Error('Not a valid TikTok URL');
    }
    
    return url;
}

async function downloadTikTok(url) {
    try {
        console.log('Attempting to download:', url);

        // Try snaptik first
        try {
            console.log('Trying snaptik.app...');
            const response = await axios({
                method: 'GET',
                url: 'https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/',
                params: {
                    aweme_id: url.split('/video/')[1]?.split('/')[0],
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Origin': 'https://www.tiktok.com',
                    'Referer': 'https://www.tiktok.com/'
                }
            });

            if (response.data?.aweme_list?.[0]?.video?.play_addr?.url_list?.[0]) {
                const videoUrl = response.data.aweme_list[0].video.play_addr.url_list[0];
                console.log('Found video URL from TikTok API:', videoUrl);
                return videoUrl;
            }
        } catch (error) {
            console.log('TikTok API failed, trying next service...');
        }

        // Try savetik as fallback
        try {
            console.log('Trying savetik.net...');
            const formData = new URLSearchParams();
            formData.append('url', url);

            const savetikResponse = await axios({
                method: 'POST',
                url: 'https://savetik.net/api/ajaxDownload',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': 'https://savetik.net',
                    'Referer': 'https://savetik.net/'
                },
                data: formData
            });

            if (savetikResponse.data?.data) {
                const parser = new RegExp(/href="([^"]+)".*?Download.*?MP4/);
                const match = savetikResponse.data.data.match(parser);
                if (match && match[1]) {
                    const videoUrl = match[1].replace(/&amp;/g, '&');
                    console.log('Found video URL from savetik:', videoUrl);
                    return videoUrl;
                }
            }
        } catch (error) {
            console.log('savetik.net failed, trying final service...');
        }

        // Try tikwm as final fallback
        console.log('Trying tikwm.com...');
        const tikwmResponse = await axios({
            method: 'POST',
            url: 'https://tikwm.com/api/',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://tikwm.com',
                'Referer': 'https://tikwm.com/'
            },
            data: new URLSearchParams({
                url: url,
                hd: 1
            })
        });

        if (tikwmResponse.data?.data?.play) {
            const videoUrl = tikwmResponse.data.data.play;
            console.log('Found video URL from tikwm:', videoUrl);
            return videoUrl;
        }

        throw new Error('Could not download video from any service');

    } catch (error) {
        console.error('Download error:', error.message);
        if (error.response) {
            console.error('Error response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        return null;
    }
}

app.get('/download', async (req, res) => {
    try {
        const videoURL = req.query.url;
        if (!videoURL) {
            return res.status(400).send('Please provide a TikTok video URL');
        }

        console.log('Original URL:', videoURL);
        const cleanURL = cleanTikTokUrl(videoURL);
        console.log('Cleaned URL:', cleanURL);

        const videoUrl = await downloadTikTok(cleanURL);
        if (!videoUrl) {
            throw new Error('Could not get video URL. Please verify that:\n1. The video is public\n2. The video URL is correct\n3. The video has not been deleted');
        }

        // Download the video
        const videoResponse = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'TikTok 26.2.0 rv:262018 (iPhone; iOS 14.4.2; en_US) Cronet',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Range': 'bytes=0-'
            },
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            },
            timeout: 30000
        });

        // Verify content type
        const contentType = videoResponse.headers['content-type'];
        if (!contentType || !contentType.includes('video')) {
            throw new Error('Invalid content type received');
        }

        // Set headers for video download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="tiktok_video_${Date.now()}.mp4"`);

        // Log download progress
        let downloadedBytes = 0;
        const totalBytes = parseInt(videoResponse.headers['content-length'] || '0');

        videoResponse.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
                const progress = Math.round((downloadedBytes / totalBytes) * 100);
                console.log(`Download progress: ${progress}%`);
            }
        });

        // Pipe the video stream to response with error handling
        videoResponse.data.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).send('Error during video streaming');
            }
        });

        videoResponse.data.pipe(res);

        // Handle response completion
        res.on('finish', () => {
            console.log('Download completed successfully');
        });

    } catch (error) {
        console.error('Download error:', error.message);
        if (error.response) {
            console.error('Error response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        res.status(500).send(error.message || 'Error downloading video. Please make sure the video URL is valid and try again.');
    }
});

app.listen(port, () => {
    console.log(`TikTok downloader app listening at http://localhost:${port}`);
});
