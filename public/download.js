// Main function that initializes the script
$(function(){

  // Event Listeners for Chrome extension messages
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.cancel) {
      cancel = true;
      sendLog('cancelling');
      sendReport('', 'Cancelling');
    }

    if (request.getLocation) {
      sendResponse(window.location.href);
    }

    if (request.action == 'scrapepage') {
      // Ensure the page is fully loaded before scraping
      if (document.readyState != 'complete') {
        alert('Please wait for the page to fully load or cancel loading');
        return false;
      }

      // Prevent multiple scraping processes from running simultaneously
      if (isBusy) {
        sendLog('Currently Scraping - Please wait');
        return false;
      }

      // Set folder name based on creator
      folder = request.creator.length > 1 ? request.creator : 'none';

      // Set scraping options
      scrapeSlideshows = request.scrapeslideshows;
      saveText = request.savetext;
      confirmbefore = request.confirmbefore;

      // Start the scraping process
      setupDocument();
    }

    if (request.finished) {
      alert(request.finished);
      isBusy = false;
      cleanup();
    }

    if (request.getSubfolder) {
      // Extract the subfolder name from the page
      var h1 = $('h1').eq(0).text();
      sendResponse({ response: h1.length > 0 ? h1 : 'not_found' });
    }

    return true;
  });

  // Cancel scraping when the cancel button is clicked
  $('body').on('click', function (e) {
    if (e.target.id === 'pat_blocker_cancel') {
      cancelScraping();
    }
  });

  // Reporting Functions
  function sendLog(message = '') {
    if (message.length > 1) {
      Thelog += message + '<br/>';
    }
    chrome.storage.local.set({ pd_log: Thelog });
  }

  function sendReport(status = '', message = '') {
    chrome.storage.local.set({ pd_status: status });
    chrome.storage.local.set({ pd_statusMessage: message });
  }

  function updateProgress(current = 0, total = 0) {
    chrome.storage.local.set({ pd_downloadStatus: [current, total] });
  }

  // Utility Functions
  function padd(num) {
    return num < 10 ? '0' + num : num;
  }

  function removeSpecialCharacters(string) {
    return string.replace(/[^\w\s]/gi, '');
  }

  function cancelScraping() {
    cancel = true;
    sendLog('cancelling');
    sendReport('', 'Cancelling');
  }

  function cleanup() {
    $('.pat_blocker').fadeOut().remove();
    isBusy = false;
    cancel = false;
    sendReport('ready', 'Ready');
    updateProgress(0, 0);
  }

  // Setup variables
  var cancel = false;
  let posts = [];
  let currentPost = -1;
  let postObjects;
  let folder = 'none';
  let Thelog = '';
  let isBusy = false;
  let saveText = false;
  let startdownload = false;
  let scrapeSlideshows = false;
  let confirmbefore = false;
  var loadmorebuttoncounter = 0;

  // Initialize the script
  sendReport('ready', 'Ready');
  chrome.storage.local.remove('pd_log');
  updateProgress(0, 0);

  // Setup the document for scraping
  function setupDocument() {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    // Add a blocker overlay to indicate scraping is in progress
    if ($('.pat_blocker').length === 0) {
      $('body').append('<div class="pat_blocker" style=""><div class="inner">Patreon Downloader scraping page, please wait.<br><button id="pat_blocker_cancel" href="#">Cancel</button></div></div>').fadeIn();
    }

    // Check for "Load More" buttons and handle them
    var loadMoreButton = false;
    $('button').each(function () {
      var $button = $(this);
      if ($button.text().toLowerCase() == 'load more') {
        loadMoreButton = $(this);
      }
    });

    if (!loadMoreButton) {
      findPosts();
    } else {
      loadmorebuttoncounter++;
      var clickLoadMore = confirm(loadmorebuttoncounter + ' --Load More-- button found. Should I click it for you? Cancel will start the scraper but scrape only the visible posts on this page');
      if (clickLoadMore) {
        loadMoreButton.trigger('click');
        setTimeout(function () {
          setupDocument();
        }, 3000);
      } else {
        findPosts();
      }
    }
  }

  // Find posts on the page
  function findPosts() {
    Thelog = '';
    isBusy = true;
    cancel = false;
    currentPost = -1;
    posts = [];

    postObjects = $('[data-tag=post-card]');

    chrome.storage.local.remove('pd_log');
    sendLog('Scraping page - please wait');
    sendReport('scraping', 'Scraping page');

    if (postObjects.length > 0) {
      scrapeData();
    } else {
      alert('Sorry, no posts found!');
      cleanup();
      return false;
    }
  }

  // Recursive function to scrape data from posts
  function scrapeData() {
    if (!cancel && currentPost == postObjects.length - 1) {
      sendToDownloader();
    } else if (!cancel) {
      currentPost++;
      setupPost(postObjects[currentPost]);
    } else {
      cleanup();
    }
  }

  // Send scraped data to the downloader
  function sendToDownloader() {
    let downloads = [];

    function prepareDownloadObject(url, subfolder, prefix = null, filename = null) {
      if (filename == null) {
        filename = url.substring(url.lastIndexOf('/') + 1);
        filename = filename.substring(0, filename.lastIndexOf('?'));
      }
      if (prefix != null) {
        filename = padd(prefix) + '_' + filename;
      }
      var subfolder = removeSpecialCharacters(subfolder);
      return {
        url: url,
        path: 'Patreon_Downloader/' + folder + '/' + subfolder + '/',
        filename: filename
      };
    }

    posts.forEach(post => {
      let counter = 0;

      if (post.slideshowimages) {
        post.slideshowimages.forEach(url => {
          downloads.push(prepareDownloadObject(url, post.name, counter));
          counter++;
        });
      }

      if (post.postimages) {
        post.postimages.forEach(url => {
          downloads.push(prepareDownloadObject(url, post.name, counter));
          counter++;
        });
      }

      if (post.files) {
        post.files.forEach(url => {
          downloads.push(prepareDownloadObject(url, post.name, null, 'auto'));
        });
      }

      if (post.text && saveText) {
        var blob = new Blob([post.text], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        downloads.push(prepareDownloadObject(url, post.name, null, 'posttext.txt'));
      }
    });

    sendLog('Finished scraping. Sending ' + downloads.length + ' files to downloader');
    sendReport('scraping', 'Sending to downloader');

    if (confirmbefore) {
      startdownload = confirm('Sending ' + downloads.length + ' files to the downloader. Have you turned off "Ask where to save each file before downloading" in Chrome settings? Press ok to send files to the downloader.');
    } else {
      startdownload = true;
    }

    if (startdownload) {
      chrome.runtime.sendMessage({ downloadSequentially: downloads });
    } else {
      sendLog('User cancelled download');
      cleanup();
    }
  }

  // Setup individual post for scraping
  function setupPost(postObject) {
    let images = [];
    let post = {};
    let loadedSrc = [];
    let text = '';

    $('html').animate({ scrollTop: $(postObject).offset().top }, 1000, 'swing', function () {
      setTimeout(() => {
        // Extract post title
        let title = $(postObject).find('[data-tag=post-title] a').html() || $(postObject).find('[data-tag=post-title]').html() || 'post title not found';
        title = title.replace(/\s+/g, '_').toLowerCase();

        // Extract post date
        let dateText = $(postObject).find("[data-tag=post-published-at]").text();
        if (dateText.length > 0) {
          let dateTextArray = dateText.split(',');
          let now = new Date();
          var date = Date.fromString(dateTextArray[0] + ' ' + now.getFullYear());
          if (typeof date.getMonth === 'function') {
            title = date.getFullYear() + '_' + (date.getMonth() + 1) + '_' + date.getDate() + '_' + title;
          }
        }

        let fileLinks = [];
        post.name = title;
        post.images = images;
        post.slideshowimages = [];
        post.postimages = [];
        post.files = fileLinks;
        post.lockedIcon = $(postObject).find('div[data-tag=locked-post-icon]');

        sendLog("Scraping post: " + post.name);

        if (post.lockedIcon.length > 0) {
          sendLog('Post is locked, moving on');
          scrapeData();
          return false;
        }

        // Extract text content
        var textfile = '';
        function textFileBuilder(text = '', newline) {
          textfile += text + '\n';
        }

        textFileBuilder('Post Date: ' + $(postObject).find('a[data-tag=post-published-at]').text());
        textFileBuilder('Title: ' + $(postObject).find('*[data-tag=post-title]').text() + '\n');

        let collapsedContent = $(postObject).find('div[data-tag=post-content-collapse] p');
        let normalContent = $(postObject).find('div[data-tag=post-content] p');
        let allContent = $(postObject).find('p,li');

        textFileBuilder('Content:');
        collapsedContent.each(function () {
          textFileBuilder($(this).text());
        });

        normalContent.each(function () {
          textFileBuilder($(this).text());
        });

        if (collapsedContent.length == 0 || normalContent.length == 0) {
          if (allContent.length) {
            allContent.each(function () {
              if ($(this).closest('[data-tag=comment-row], [data-tag="comment-post-icon"]').length === 0) {
                textFileBuilder($(this).text());
              }
            });
          }
        }

        textFileBuilder();
        textFileBuilder('Comments:');
        textFileBuilder();

        let comments = $(postObject).find('div[data-tag=comment-row]');
        comments.each(function () {
          textFileBuilder($(this).find('a[data-tag=commenter-name]').text());
          textFileBuilder($(this).find('div[data-tag=comment-body]').text());
          textFileBuilder();
        });

        post.text = textfile;

        // Extract images
        $(postObject).find('img').each(function (index, item) {
          if (!loadedSrc.includes(item.src)) {
            images.push(item);
            loadedSrc.push(item.src);
          }
        });

        // Extract file links
        let links = $(postObject).find('a');
        links.each(function () {
          if ($(this).attr('href').indexOf('file?') > 0) {
            fileLinks.push($(this).attr('href'));
          }
        });
        sendLog(fileLinks.length + ' files found');

        if (images.length > 0 || fileLinks.length > 0 || saveText) {
          posts.push(post);
          findPostImages(post);
          if (scrapeSlideshows) {
            findSlideshows(post);
          } else {
            scrapeData();
          }
        } else {
          sendLog('No images or files found. Moving on');
          scrapeData();
        }
      }, 1000);
    });
  }

  // Find slideshows in a post
  function findSlideshows(post) {
    const targetNode = document.getElementsByTagName('body');
    const config = { attributes: false, childList: true, subtree: false };
    let foundLightbox = false;

    const callback = function (mutationsList, observer) {
      for (let mutation of mutationsList) {
        if (foundLightbox) {
          return false;
        }

        if (mutation.type === 'childList') {
          const lightbox = $('[data-target=lightbox-content]');
          if (lightbox.length > 0) {
            foundLightbox = true;
            observer.disconnect();
            var img = lightbox.find('img');
            observeSlideshow(img[0], post);
          }
        }
      }
    };

    const observer = new MutationObserver(callback);
    observer.observe(targetNode[0], config);

    if (post.images.length > 0) {
      post.images[0].click();
    }

    // Wait to see if slideshow appears
    setTimeout(() => {
      if (!foundLightbox) {
        observer.disconnect();
        scrapeData();
      }
    }, 2000);
  }

  // Observe slideshow images
  function observeSlideshow(element, post) {
    let images = [];
    const config = { attributes: true, childList: false, subtree: false };
    let total;

    const callback = function () {
      if (!images.includes(element.src)) {
        images.push(element.src);
      }
    };

    const loaded = function () {
      total = $('[data-target=lightbox-content]').find('p').html();
      if (total) {
        total = total.split('/');
        total = parseInt(total[1]);
      }
      if (total && images.length == total) {
        finishSlideshow();
      } else {
        // Check if next button exists
        let nextButton = $('[data-target=lightbox-content]').parent().find('button')[1];
        if (nextButton && !cancel) {
          setTimeout(function () { $('[data-target=lightbox-content]').parent().find('button')[1].click(); }, 1000);
        } else {
          finishSlideshow();
        }
      }
    };

    function finishSlideshow() {
      observer.disconnect();
      post.slideshowimages = images;
      let buttons = $('[data-target=lightbox-content]').parent().find('button');
      if (buttons.length > 1) {
        buttons[2].click();
      } else {
        buttons[0].click();
      }
      if (!cancel) {
        scrapeData();
      } else {
        cleanup();
      }
    }

    element.addEventListener('load', function () {
      loaded();
    });

    const observer = new MutationObserver(callback);
    observer.observe(element, config);
  }

  // Find images in a post
  function findPostImages(post) {
    var postimages = [];

    post.images.forEach((img, iindex) => {
      if (img) {
        var filename = img.src.substring(img.src.lastIndexOf('/') + 1);
        filename = filename.substring(0, filename.lastIndexOf('?'));

        if (filename && filename.length > 4) { // Check for valid file
          if (img.naturalWidth == 0) { // Add images that were not loaded
            postimages.push(img.src);
          } else if (img.naturalWidth > 400) {
            postimages.push(img.src);
          }
        }
      }
    });

    post.postimages = postimages;
    sendLog((post.postimages.length + post.slideshowimages.length) + ' images found');
    chrome.storage.local.get(['pd_downloadStatus'], function (result) {
      updateProgress(0, post.postimages.length + post.slideshowimages.length + result.pd_downloadStatus[1]);
    });
  }
});
