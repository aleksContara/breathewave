/**
 * CTR PDP — Alpine.js store + buy box / sticky ATC interactivity
 * Must load BEFORE alpine.min.js (registers on alpine:init).
 */
(function () {
  'use strict';

  function formatMoney(cents, format) {
    if (typeof cents !== 'number' || isNaN(cents)) return '';
    if (typeof Shopify !== 'undefined' && typeof Shopify.formatMoney === 'function') {
      return Shopify.formatMoney(cents, format);
    }
    return '$' + (cents / 100).toFixed(2);
  }

  function findVariant(variants, selectedOptions) {
    return variants.find(function (v) {
      return v.options.every(function (opt, i) {
        return opt === selectedOptions[i];
      });
    });
  }

  function getSelectedVariant(store) {
    return (
      store.variants.find(function (v) {
        return String(v.id) === String(store.selectedVariantId);
      }) || store.variants[0]
    );
  }

  function refreshStorePricing(store) {
    var v = getSelectedVariant(store);
    if (!v) {
      store.formattedPrice = '';
      store.formattedComparePrice = '';
      store.available = false;
      store.variantImage = store.galleryImage || '';
      return;
    }
    store.available = !!v.available;
    store.formattedPrice = formatMoney(v.price, store.moneyFormat);
    store.formattedComparePrice =
      v.compare_at_price && v.compare_at_price > v.price
        ? formatMoney(v.compare_at_price, store.moneyFormat)
        : '';
    store.variantImage = v.smart_image || v.featured_image || store.galleryImage || '';
  }

  function dispatchCartUpdate(cart, variantId, sourceId) {
    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: sourceId || 'ctr-pdp',
          data: {
            source: 'ctr-pdp',
            variantId: String(variantId),
            itemCount: cart && cart.item_count,
          },
        },
      })
    );
  }

  function registerAlpine() {
    Alpine.store('ctrPdp', {
      selectedVariantId: null,
      quantity: 1,
      adding: false,
      added: false,
      buyBoxVisible: true,
      galleryImage: '',
      productTitle: '',
      variants: [],
      options: [],
      moneyFormat: '',
      selectedOptions: [],
      formattedPrice: '',
      formattedComparePrice: '',
      available: false,
      variantImage: '',

      setOption: function (position, value) {
        var idx = position - 1;
        this.selectedOptions[idx] = value;
        var match = findVariant(this.variants, this.selectedOptions);
        if (match) {
          this.selectedVariantId = match.id;
          refreshStorePricing(this);
        }
      },

      addToCart: function (variantId, qty, sourceId) {
        if (this.adding) return Promise.resolve();
        this.adding = true;
        this.added = false;
        var id = variantId || this.selectedVariantId;
        var quantity = qty || this.quantity || 1;
        var self = this;

        return fetch((window.Theme && Theme.routes.cart_add_url) || '/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: [{ id: Number(id), quantity: Number(quantity) }] }),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              if (!res.ok) throw new Error(data.description || data.message || 'Add to cart failed');
              return data;
            });
          })
          .then(function (data) {
            self.added = true;
            setTimeout(function () {
              self.added = false;
            }, 2000);
            dispatchCartUpdate(data, id, sourceId);
          })
          .catch(function (err) {
            console.error('[ctr-pdp] addToCart:', err);
          })
          .finally(function () {
            self.adding = false;
          });
      },
    });

    Alpine.data('ctrPdpBuyBox', function () {
      return {
        selectedMediaId: null,
        mediaItems: [],
        galleryObserver: null,

        init: function () {
          var el = this.$root;
          var dataEl = el.querySelector('[data-ctr-pdp-json]');
          if (!dataEl) return;

          var data;
          try {
            data = JSON.parse(dataEl.textContent);
          } catch (e) {
            console.error('[ctr-pdp] Invalid product JSON', e);
            return;
          }

          var store = Alpine.store('ctrPdp');
          store.variants = data.variants || [];
          store.options = data.options || [];
          store.moneyFormat = data.moneyFormat || (window.Shopify && Shopify.money_format) || '';
          store.productTitle = data.title || '';
          store.galleryImage = data.featuredImage || '';
          store.selectedOptions = (data.variants[0] && data.variants[0].options.slice()) || [];
          store.selectedVariantId = data.selectedVariantId || (data.variants[0] && data.variants[0].id);
          store.quantity = 1;

          this.mediaItems = data.media || [];
          this.selectedMediaId = (this.mediaItems[0] && this.mediaItems[0].id) || null;

          refreshStorePricing(store);

          var self = this;
          this.$watch('$store.ctrPdp.selectedVariantId', function (variantId) {
            if (!variantId) return;
            var v = store.variants.find(function (item) {
              return String(item.id) === String(variantId);
            });
            if (v && v.featured_media_id) self.scrollToMedia(v.featured_media_id);
          });

          this.$nextTick(function () {
            self.$root.querySelectorAll('input[data-option-position]').forEach(function (input) {
              var idx = Number(input.dataset.optionPosition) - 1;
              input.checked = store.selectedOptions[idx] === input.dataset.optionValue;
            });
            self.setupGalleryObserver();
          });
        },

        setupGalleryObserver: function () {
          var self = this;
          var stack = this.$refs.galleryStack;
          if (!stack || typeof IntersectionObserver === 'undefined') return;

          if (this.galleryObserver) this.galleryObserver.disconnect();

          var figures = stack.querySelectorAll('[data-media-id]');
          if (!figures.length) return;

          var isMobile = window.matchMedia('(max-width: 767px)').matches;
          this.galleryObserver = new IntersectionObserver(
            function (entries) {
              entries.forEach(function (entry) {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
                  var id = Number(entry.target.dataset.mediaId);
                  if (id) self.selectedMediaId = id;
                }
              });
            },
            { root: isMobile ? stack : null, rootMargin: '-20% 0px -40% 0px', threshold: [0.4, 0.6] }
          );

          figures.forEach(function (fig) {
            self.galleryObserver.observe(fig);
          });
        },

        scrollToMedia: function (mediaId) {
          this.selectedMediaId = Number(mediaId);
          var stack = this.$refs.galleryStack;
          if (!stack) return;

          var target = stack.querySelector('[data-media-id="' + mediaId + '"]');
          if (!target) return;

          var isMobile = window.matchMedia('(max-width: 767px)').matches;
          target.scrollIntoView({
            behavior: 'smooth',
            block: isMobile ? 'nearest' : 'start',
            inline: isMobile ? 'center' : 'nearest',
          });
        },

        pickThumb: function (event) {
          var id = Number(event.currentTarget.dataset.mediaId);
          if (id) this.scrollToMedia(id);
        },

        pickOption: function (event) {
          var input = event.target;
          var position = Number(input.dataset.optionPosition);
          var value = input.dataset.optionValue;
          if (!position || value === undefined) return;
          Alpine.store('ctrPdp').setOption(position, value);
        },

        decrementQty: function () {
          if (Alpine.store('ctrPdp').quantity > 1) Alpine.store('ctrPdp').quantity--;
        },

        incrementQty: function () {
          Alpine.store('ctrPdp').quantity++;
        },

        addToCart: function () {
          Alpine.store('ctrPdp').addToCart();
        },

        hideBuyBox: function () {
          Alpine.store('ctrPdp').buyBoxVisible = false;
        },

        showBuyBox: function () {
          Alpine.store('ctrPdp').buyBoxVisible = true;
        },

        playUgcVideo: function (event) {
          var wrap = event.currentTarget;
          var video = wrap.querySelector('video');
          if (!video) return;
          wrap.classList.add('pdp-bb__ugc-item--playing');
          video.controls = true;
          video.play();
        },
      };
    });

    Alpine.data('ctrPdpSticky', function () {
      return {
        addToCart: function () {
          Alpine.store('ctrPdp').addToCart(null, null, 'ctr-pdp-sticky');
        },
      };
    });

    Alpine.data('ctrPdpFaq', function () {
      return {
        activeTab: 0,
        setTab: function (i) {
          this.activeTab = i;
        },
      };
    });

    Alpine.data('ctrPdpUpsell', function () {
      return {
        addingId: null,
        addProduct: function (variantId) {
          var self = this;
          if (self.addingId) return;
          self.addingId = variantId;
          Alpine.store('ctrPdp')
            .addToCart(variantId, 1, 'ctr-pdp-upsell')
            .finally(function () {
              self.addingId = null;
            });
        },
      };
    });
  }

  document.addEventListener('alpine:init', registerAlpine);
})();
